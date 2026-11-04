import sanitizeFilename from 'sanitize-filename'
import type { OutputFormat } from './model'

export const outputExtension = (format: OutputFormat): '.md' | '.txt' =>
  format === 'markdown' ? '.md' : '.txt'

export function sanitizeOutputBasename(value: string): string {
  const withoutExtension = value.replace(/\.(md|txt)$/i, '')
  const sanitized = sanitizeFilename(withoutExtension, { replacement: '-' })
    .replace(/[. ]+$/g, '')
    .trim()
  return sanitized || 'project-context'
}

export function outputFilename(value: string, format: OutputFormat): string {
  return `${sanitizeOutputBasename(value)}${outputExtension(format)}`
}

export function defaultOutputBasename(projectName: string, profileName: string): string {
  return sanitizeOutputBasename(`${projectName}-${profileName}`)
}
