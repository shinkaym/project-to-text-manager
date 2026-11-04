import { minimatch } from 'minimatch'
import type { Selection } from './model'
import type { FrameworkPreset } from './presets'

const normalize = (value: string): string =>
  value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')

export function matchingManualRule(path: string, rules: string[]): string | undefined {
  const target = normalize(path)
  return rules
    .map(normalize)
    .filter((rule) => target === rule || target.startsWith(`${rule}/`))
    .sort((a, b) => b.length - a.length)[0]
}

export function resolveSelection(input: {
  relativePath: string
  binary: boolean
  selection: Selection
  preset: FrameworkPreset
  gitIgnored: boolean
}): { selected: boolean; reason?: 'binary' | 'preset' | 'gitignore' } {
  if (input.binary) return { selected: false, reason: 'binary' }
  const includeRule = matchingManualRule(input.relativePath, input.selection.manualIncludes)
  const excludeRule = matchingManualRule(input.relativePath, input.selection.manualExcludes)
  if (includeRule || excludeRule) {
    if (includeRule && (!excludeRule || includeRule.length >= excludeRule.length))
      return { selected: true }
    return { selected: false }
  }
  const path = normalize(input.relativePath)
  const presetIncluded = input.preset.include.some((pattern) =>
    minimatch(path, pattern, { dot: true, nocase: true })
  )
  const presetExcluded = input.preset.exclude.some((pattern) =>
    minimatch(path, pattern, { dot: true, nocase: true })
  )
  if (input.gitIgnored) return { selected: false, reason: 'gitignore' }
  if (!presetIncluded || presetExcluded) return { selected: false, reason: 'preset' }
  return { selected: true }
}

export function setManualSelection(
  selection: Selection,
  path: string,
  selected: boolean
): Selection {
  const normalized = normalize(path)
  return selected
    ? {
        manualIncludes: [
          ...selection.manualIncludes.filter((item) => normalize(item) !== normalized),
          normalized
        ],
        manualExcludes: selection.manualExcludes.filter((item) => normalize(item) !== normalized)
      }
    : {
        manualIncludes: selection.manualIncludes.filter((item) => normalize(item) !== normalized),
        manualExcludes: [
          ...selection.manualExcludes.filter((item) => normalize(item) !== normalized),
          normalized
        ]
      }
}
