import { realpath } from 'node:fs/promises'
import path from 'node:path'

export const portablePath = (value: string): string => value.replaceAll('\\', '/')

export async function canonicalPath(value: string): Promise<string> {
  const resolved = await realpath(value)
  return path
    .normalize(resolved)
    .replace(/[\\/]+$/, '')
    .toLocaleLowerCase('en-US')
}

export function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function resolveInsideRoot(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error('Absolute paths are not accepted')
  const target = path.resolve(root, relativePath)
  if (!isWithinRoot(root, target)) throw new Error('Path escapes project root')
  return target
}
