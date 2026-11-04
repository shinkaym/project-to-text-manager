import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import iconv from 'iconv-lite'

export type DetectedEncoding = { encoding: string; bomBytes: number }

async function readSample(target: string, length = 65536): Promise<Buffer> {
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function validUtf8(target: string, bomBytes: number): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let first = true
  try {
    for await (const chunkValue of createReadStream(target)) {
      let chunk = chunkValue as Buffer
      if (first && bomBytes) chunk = chunk.subarray(bomBytes)
      first = false
      decoder.decode(chunk, { stream: true })
    }
    decoder.decode()
    return true
  } catch {
    return false
  }
}

export async function detectTextEncoding(target: string): Promise<DetectedEncoding> {
  const sample = await readSample(target)
  if (sample.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    return { encoding: 'utf8', bomBytes: 3 }
  if (sample.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])))
    return { encoding: 'utf16-le', bomBytes: 2 }
  if (sample.subarray(0, 2).equals(Buffer.from([0xfe, 0xff])))
    return { encoding: 'utf16-be', bomBytes: 2 }
  if (await validUtf8(target, 0)) return { encoding: 'utf8', bomBytes: 0 }
  let evenZeros = 0
  let oddZeros = 0
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) index % 2 === 0 ? (evenZeros += 1) : (oddZeros += 1)
  }
  if (oddZeros > sample.length / 8) return { encoding: 'utf16-le', bomBytes: 0 }
  if (evenZeros > sample.length / 8) return { encoding: 'utf16-be', bomBytes: 0 }
  if (!iconv.encodingExists('windows-1252')) throw new Error('No supported fallback encoding')
  return { encoding: 'windows-1252', bomBytes: 0 }
}

export async function readTextSample(target: string, maxBytes = 262144): Promise<string> {
  const encoding = await detectTextEncoding(target)
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + encoding.bomBytes)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return iconv.decode(buffer.subarray(encoding.bomBytes, bytesRead), encoding.encoding)
  } finally {
    await handle.close()
  }
}
