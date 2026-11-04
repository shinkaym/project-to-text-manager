import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { minimatch } from 'minimatch'
import type { FileTreeNode, Project, ScanResult } from '../../shared/model'
import { BUILT_IN_HARD_EXCLUDES, PRESETS } from '../../shared/presets'
import { resolveSelection } from '../../shared/selection'
import { isWithinRoot, portablePath } from './path-security'

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.pdf',
  '.zip',
  '.7z',
  '.rar',
  '.gz',
  '.exe',
  '.dll',
  '.pdb',
  '.so',
  '.dylib',
  '.class',
  '.jar',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.wav',
  '.db',
  '.sqlite',
  '.bin'
])

export function sampleLooksBinary(filename: string, sample: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filename).toLowerCase())) return true
  if (
    sample.length >= 2 &&
    ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff))
  )
    return false
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 0) return true
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return sample.length > 0 && suspicious / sample.length > 0.1
}

async function binaryFile(target: string, relativePath: string): Promise<boolean> {
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return sampleLooksBinary(relativePath, buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function createGitignore(content: string | null): Ignore {
  const instance = ignore()
  if (content) instance.add(content)
  return instance
}

export async function scanProject(input: {
  project: Project
  profileId: string
  globalHardExcludes: string[]
}): Promise<ScanResult> {
  const { project } = input
  const profile = project.profiles.find((candidate) => candidate.id === input.profileId)
  if (!profile) throw new Error('Profile not found')
  const rootReal = await realpath(project.path)
  const preset = PRESETS[project.framework]
  const hardRules = [
    ...BUILT_IN_HARD_EXCLUDES,
    ...preset.hardExcludeDirectories,
    ...input.globalHardExcludes,
    ...project.hardExcludes
  ]
  const gitignoreText = await readFile(path.join(rootReal, '.gitignore'), 'utf8').catch(() => null)
  const gitignore = createGitignore(gitignoreText)
  const nodes: FileTreeNode[] = []
  const warnings: string[] = []
  const visitedDirectories = new Set<string>()
  const visitedFiles = new Set<string>()

  const hardExcluded = (relative: string, name: string): boolean =>
    hardRules.some((rule) => {
      const normalized = portablePath(rule).replace(/^\.\//, '').replace(/\/+$/, '')
      return (
        name.toLocaleLowerCase('en-US') === normalized.toLocaleLowerCase('en-US') ||
        minimatch(relative, normalized, { dot: true, nocase: true }) ||
        minimatch(relative, `${normalized}/**`, { dot: true, nocase: true })
      )
    })

  const walk = async (
    absoluteDirectory: string,
    relativeDirectory: string,
    depth: number
  ): Promise<void> => {
    const directoryReal = await realpath(absoluteDirectory).catch(() => absoluteDirectory)
    const canonicalDirectory = directoryReal.toLocaleLowerCase('en-US')
    if (visitedDirectories.has(canonicalDirectory)) return
    visitedDirectories.add(canonicalDirectory)
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(
      (error: unknown) => {
        warnings.push(`Cannot read ${relativeDirectory || '.'}: ${(error as Error).message}`)
        return []
      }
    )
    entries.sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
    )
    for (const entry of entries) {
      const relative = portablePath(path.join(relativeDirectory, entry.name))
      if (hardExcluded(relative, entry.name)) continue
      const absolute = path.join(absoluteDirectory, entry.name)
      let stats
      try {
        stats = await lstat(absolute)
      } catch (error) {
        warnings.push(`Cannot inspect ${relative}: ${(error as Error).message}`)
        continue
      }
      const symlink = stats.isSymbolicLink()
      let resolved = absolute
      if (symlink) {
        try {
          resolved = await realpath(absolute)
        } catch {
          warnings.push(`Broken link ignored: ${relative}`)
          continue
        }
        if (!isWithinRoot(rootReal, resolved)) {
          warnings.push(`External link ignored: ${relative}`)
          continue
        }
      }
      const resolvedStats = symlink ? await lstat(resolved).catch(() => stats) : stats
      const isDirectory = entry.isDirectory() || (symlink && resolvedStats.isDirectory())
      const hidden = entry.name.startsWith('.')
      if (isDirectory) {
        nodes.push({
          id: relative,
          relativePath: relative,
          name: entry.name,
          parentPath: relativeDirectory || null,
          kind: 'directory',
          depth,
          size: 0,
          mtimeMs: stats.mtimeMs,
          hidden,
          binary: false,
          symlink,
          selectable: false,
          selectedByDefault: false
        })
        await walk(absolute, relative, depth + 1)
      } else if (entry.isFile() || symlink) {
        const fileReal = await realpath(absolute).catch(() => absolute)
        const canonicalFile = fileReal.toLocaleLowerCase('en-US')
        if (visitedFiles.has(canonicalFile)) continue
        visitedFiles.add(canonicalFile)
        let binary = false
        try {
          binary = await binaryFile(absolute, relative)
        } catch (error) {
          warnings.push(`Cannot sample ${relative}: ${(error as Error).message}`)
        }
        const ignored = gitignore.ignores(relative)
        const resolution = resolveSelection({
          relativePath: relative,
          binary,
          selection: profile.selection,
          preset,
          gitIgnored: ignored
        })
        nodes.push({
          id: relative,
          relativePath: relative,
          name: entry.name,
          parentPath: relativeDirectory || null,
          kind: 'file',
          depth,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          hidden,
          binary,
          symlink,
          selectable: !binary,
          selectedByDefault: resolution.selected,
          exclusionReason: resolution.reason
        })
      }
    }
  }

  await walk(rootReal, '', 0)
  const folderCounts = new Map<string, { total: number; selected: number }>()
  for (const node of nodes) {
    if (node.kind !== 'file' || !node.selectable) continue
    const parts = node.relativePath.split('/').slice(0, -1)
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const folder = parts.slice(0, depth).join('/')
      const counts = folderCounts.get(folder) ?? { total: 0, selected: 0 }
      counts.total += 1
      if (node.selectedByDefault) counts.selected += 1
      folderCounts.set(folder, counts)
    }
  }
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    const counts = folderCounts.get(node.relativePath) ?? { total: 0, selected: 0 }
    node.selectable = counts.total > 0
    node.selectedByDefault = counts.total > 0 && counts.selected === counts.total
  }
  return { projectId: project.id, nodes, scannedAt: new Date().toISOString(), warnings }
}
