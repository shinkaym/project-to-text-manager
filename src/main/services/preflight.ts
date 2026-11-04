import { constants } from 'node:fs'
import { access, mkdir, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { minimatch } from 'minimatch'
import type {
  AppConfig,
  ConversionRequest,
  PreflightIssue,
  PreflightResult,
  Project
} from '../../shared/model'
import { outputFilename } from '../../shared/output'
import { BUILT_IN_HARD_EXCLUDES, PRESETS } from '../../shared/presets'
import { detectTextEncoding, readTextSample } from './encoding'
import { sampleLooksBinary } from './file-scanner'
import { isWithinRoot, resolveInsideRoot } from './path-security'

const LARGE_FILE_WARNING_BYTES = 5 * 1024 * 1024
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  [
    'credential-like assignment',
    /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\r\n]{8,}["']/i
  ]
]

export class PreflightService {
  async run(config: AppConfig, request: ConversionRequest): Promise<PreflightResult> {
    const project = config.projects.find((candidate) => candidate.id === request.projectId)
    if (!project) throw new Error('Project not found')
    if (!project.profiles.some((profile) => profile.id === request.profileId))
      throw new Error('Profile not found')
    const issues: PreflightIssue[] = []
    if (request.selectedFiles.length === 0)
      issues.push({ severity: 'error', code: 'empty', message: 'Select at least one text file.' })
    for (const baseline of request.selectedFiles)
      await this.validateFile(project, baseline, issues, config.settings.globalHardExcludes)

    await mkdir(config.settings.outputDirectory, { recursive: true }).catch((error: unknown) => {
      issues.push({
        severity: 'error',
        code: 'output',
        message: `Cannot create output directory: ${(error as Error).message}`
      })
    })
    await access(config.settings.outputDirectory, constants.W_OK).catch((error: unknown) => {
      issues.push({
        severity: 'error',
        code: 'output',
        message: `Output directory is not writable: ${(error as Error).message}`
      })
    })
    const outputPath = path.join(
      config.settings.outputDirectory,
      outputFilename(request.filename, request.format)
    )
    const outputExists = await access(outputPath).then(
      () => true,
      () => false
    )
    return {
      valid: !issues.some((issue) => issue.severity === 'error'),
      issues,
      outputPath,
      outputExists
    }
  }

  private async validateFile(
    project: Project,
    baseline: ConversionRequest['selectedFiles'][number],
    issues: PreflightIssue[],
    globalHardExcludes: string[]
  ): Promise<void> {
    const relative = baseline.relativePath.replaceAll('\\', '/')
    const hardRules = [
      ...BUILT_IN_HARD_EXCLUDES,
      ...PRESETS[project.framework].hardExcludeDirectories,
      ...globalHardExcludes,
      ...project.hardExcludes
    ]
    const hardExcluded = hardRules.some((rule) => {
      const normalized = rule.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
      return (
        relative
          .split('/')
          .some(
            (segment) =>
              segment.toLocaleLowerCase('en-US') === normalized.toLocaleLowerCase('en-US')
          ) ||
        minimatch(relative, normalized, { dot: true, nocase: true }) ||
        minimatch(relative, `${normalized}/**`, { dot: true, nocase: true })
      )
    })
    if (hardExcluded) {
      issues.push({
        severity: 'error',
        code: 'outside-root',
        relativePath: baseline.relativePath,
        message: 'Selected path is hard-excluded.'
      })
      return
    }
    let target: string
    try {
      target = resolveInsideRoot(project.path, baseline.relativePath)
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'outside-root',
        relativePath: baseline.relativePath,
        message: (error as Error).message
      })
      return
    }
    let fileStat
    try {
      fileStat = await stat(target)
    } catch {
      issues.push({
        severity: 'error',
        code: 'missing',
        relativePath: baseline.relativePath,
        message: 'Selected file no longer exists.'
      })
      return
    }
    if (!fileStat.isFile()) {
      issues.push({
        severity: 'error',
        code: 'unreadable',
        relativePath: baseline.relativePath,
        message: 'Selected path is not a file.'
      })
      return
    }
    const resolvedRoot = await realpath(project.path)
    const resolvedFile = await realpath(target).catch(() => target)
    if (!isWithinRoot(resolvedRoot, resolvedFile)) {
      issues.push({
        severity: 'error',
        code: 'outside-root',
        relativePath: baseline.relativePath,
        message: 'Link target is outside the project.'
      })
      return
    }
    if (fileStat.size !== baseline.size || Math.abs(fileStat.mtimeMs - baseline.mtimeMs) > 1) {
      issues.push({
        severity: 'error',
        code: 'changed',
        relativePath: baseline.relativePath,
        message: 'File changed after the tree scan. Refresh and try again.'
      })
    }
    const handle = await open(target, 'r').catch(() => null)
    if (!handle) {
      issues.push({
        severity: 'error',
        code: 'unreadable',
        relativePath: baseline.relativePath,
        message: 'Selected file cannot be read.'
      })
      return
    }
    const sampleBuffer = Buffer.alloc(Math.min(fileStat.size, 8192))
    await handle.read(sampleBuffer, 0, sampleBuffer.length, 0)
    await handle.close()
    if (sampleLooksBinary(baseline.relativePath, sampleBuffer)) {
      issues.push({
        severity: 'error',
        code: 'binary',
        relativePath: baseline.relativePath,
        message: 'Binary files cannot be converted.'
      })
      return
    }
    try {
      await detectTextEncoding(target)
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'encoding',
        relativePath: baseline.relativePath,
        message: `Unsupported or invalid text encoding: ${(error as Error).message}`
      })
      return
    }
    if (fileStat.size >= LARGE_FILE_WARNING_BYTES) {
      issues.push({
        severity: 'warning',
        code: 'large-file',
        relativePath: baseline.relativePath,
        message: `Large file (${Math.ceil(fileStat.size / 1024 / 1024)} MB) may take longer to convert.`
      })
    }
    try {
      const sample = await readTextSample(target)
      const found = SECRET_PATTERNS.find(([, pattern]) => pattern.test(sample))
      if (found)
        issues.push({
          severity: 'warning',
          code: 'secret',
          relativePath: baseline.relativePath,
          message: `Possible ${found[0]} detected. Content will not be altered.`
        })
    } catch {
      /* encoding was already validated; conversion will re-check */
    }
  }
}
