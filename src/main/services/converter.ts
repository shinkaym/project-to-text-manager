import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'
import type { ConversionRequest, Project, TaskLog } from '../../shared/model'
import { detectTextEncoding } from './encoding'
import { documentStart, fileEnd, fileStart } from './document-renderer'
import { isWithinRoot, resolveInsideRoot } from './path-security'

type ConversionHooks = {
  signal: AbortSignal
  log: (level: TaskLog['level'], message: string) => void
  progress: (value: number, currentFile: string, processedCount: number, totalCount: number) => void
}

async function writeChunk(
  stream: ReturnType<typeof createWriteStream>,
  chunk: string
): Promise<void> {
  if (!chunk || stream.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    stream.once('drain', resolve)
    stream.once('error', reject)
  })
}

async function inspectFenceAndEnding(
  target: string,
  encodingName: string,
  bomBytes: number,
  signal: AbortSignal
): Promise<{ fence: number; endsWithNewline: boolean }> {
  const decoder = iconv.getDecoder(encodingName)
  let first = true
  let carryRun = 0
  let maxRun = 0
  let lastCharacter = ''
  for await (const value of createReadStream(target)) {
    if (signal.aborted) throw new Error('Conversion cancelled')
    let chunk = value as Buffer
    if (first && bomBytes) chunk = chunk.subarray(bomBytes)
    first = false
    const text = decoder.write(chunk)
    for (const character of text) {
      if (character === '`') {
        carryRun += 1
        maxRun = Math.max(maxRun, carryRun)
      } else carryRun = 0
      lastCharacter = character
    }
  }
  const tail = decoder.end() ?? ''
  for (const character of tail) {
    if (character === '`') {
      carryRun += 1
      maxRun = Math.max(maxRun, carryRun)
    } else carryRun = 0
    lastCharacter = character
  }
  return { fence: Math.max(3, maxRun + 1), endsWithNewline: lastCharacter === '\n' }
}

async function appendFile(
  writer: ReturnType<typeof createWriteStream>,
  target: string,
  encodingName: string,
  bomBytes: number,
  signal: AbortSignal
): Promise<void> {
  const decoder = iconv.getDecoder(encodingName)
  let first = true
  for await (const value of createReadStream(target)) {
    if (signal.aborted) throw new Error('Conversion cancelled')
    let chunk = value as Buffer
    if (first && bomBytes) chunk = chunk.subarray(bomBytes)
    first = false
    await writeChunk(writer, decoder.write(chunk))
  }
  await writeChunk(writer, decoder.end() ?? '')
}

export async function convertToFile(
  project: Project,
  request: ConversionRequest,
  outputPath: string,
  hooks: ConversionHooks
): Promise<void> {
  const sorted = [...request.selectedFiles].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, 'en', { sensitivity: 'base', numeric: true })
  )
  const rootReal = await realpath(project.path)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  const writer = createWriteStream(tempPath, { encoding: 'utf8', flags: 'wx' })
  try {
    await writeChunk(
      writer,
      documentStart(
        request.format,
        project.displayName,
        sorted.map((item) => item.relativePath)
      )
    )
    for (let index = 0; index < sorted.length; index += 1) {
      if (hooks.signal.aborted) throw new Error('Conversion cancelled')
      const baseline = sorted[index]!
      const target = resolveInsideRoot(project.path, baseline.relativePath)
      const targetReal = await realpath(target)
      if (!isWithinRoot(rootReal, targetReal))
        throw new Error(`${baseline.relativePath} resolves outside the project`)
      const current = await stat(target)
      if (current.size !== baseline.size || Math.abs(current.mtimeMs - baseline.mtimeMs) > 1)
        throw new Error(`${baseline.relativePath} changed after preflight`)
      hooks.progress(
        Math.round((index / sorted.length) * 100),
        baseline.relativePath,
        index,
        sorted.length
      )
      const encoding = await detectTextEncoding(target)
      const inspection = await inspectFenceAndEnding(
        target,
        encoding.encoding,
        encoding.bomBytes,
        hooks.signal
      )
      hooks.log('info', `Writing ${baseline.relativePath} (${encoding.encoding})`)
      await writeChunk(writer, fileStart(request.format, baseline.relativePath, inspection.fence))
      await appendFile(writer, target, encoding.encoding, encoding.bomBytes, hooks.signal)
      const afterRead = await stat(target)
      if (afterRead.size !== baseline.size || Math.abs(afterRead.mtimeMs - baseline.mtimeMs) > 1)
        throw new Error(`${baseline.relativePath} changed during conversion`)
      await writeChunk(
        writer,
        fileEnd(request.format, inspection.fence, inspection.endsWithNewline)
      )
      hooks.progress(
        Math.round(((index + 1) / sorted.length) * 100),
        baseline.relativePath,
        index + 1,
        sorted.length
      )
    }
    for (const baseline of sorted) {
      const target = resolveInsideRoot(project.path, baseline.relativePath)
      const finalState = await stat(target)
      if (finalState.size !== baseline.size || Math.abs(finalState.mtimeMs - baseline.mtimeMs) > 1)
        throw new Error(`${baseline.relativePath} changed during conversion`)
    }
    await new Promise<void>((resolve, reject) =>
      writer.end((error?: Error | null) => (error ? reject(error) : resolve()))
    )
    await rename(tempPath, outputPath)
  } catch (error) {
    writer.destroy()
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}
