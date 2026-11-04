import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import type { AppConfig, ConversionRequest, Project } from '../src/shared/model'
import { APP_CONFIG_VERSION } from '../src/shared/model'
import { detectFrameworks } from '../src/main/services/framework-detector'
import { scanProject } from '../src/main/services/file-scanner'
import { PreflightService } from '../src/main/services/preflight'
import { convertToFile } from '../src/main/services/converter'

const projectFixture = (root: string): Project => ({
  id: 'project-1',
  displayName: 'Fixture',
  path: root,
  canonicalPath: root.toLowerCase(),
  framework: 'generic',
  groupId: null,
  order: 0,
  profiles: [
    {
      id: 'profile-1',
      name: 'Default',
      presetVersion: 1,
      selection: { manualIncludes: [], manualExcludes: [] }
    }
  ],
  activeProfileId: 'profile-1',
  hardExcludes: [],
  customOutputBasename: null
})

const configFixture = (project: Project, outputDirectory: string): AppConfig => ({
  schemaVersion: APP_CONFIG_VERSION,
  groups: [],
  projects: [project],
  retainedProjectConfigs: [],
  settings: {
    outputDirectory,
    showHiddenFiles: true,
    watcherEnabled: true,
    notificationsEnabled: false,
    taskConcurrency: 1,
    globalHardExcludes: [],
    checkForUpdatesOnStartup: false
  }
})

describe('framework detection', () => {
  it('detects multiple framework evidence and requires a primary choice upstream', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-framework-'))
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19', electron: '^39' } })
    )
    const detections = await detectFrameworks(root)
    expect(detections.map((item) => item.id)).toEqual(expect.arrayContaining(['react', 'electron']))
  })

  it('falls back to Generic Project when no marker exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-generic-'))
    expect((await detectFrameworks(root))[0]?.id).toBe('generic')
  })
})

describe('filesystem scan boundaries', () => {
  it('hides hard excludes, keeps binary visible, and permits a manual .gitignore override', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-scan-'))
    await mkdir(path.join(root, 'node_modules'), { recursive: true })
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored')
    await writeFile(path.join(root, '.gitignore'), 'src/soft.ts\n')
    await writeFile(path.join(root, 'src', 'soft.ts'), 'export const soft = true')
    await writeFile(path.join(root, 'image.png'), Buffer.from([0, 1, 2, 3]))
    const project = projectFixture(root)
    project.profiles[0]!.selection.manualIncludes = ['src/soft.ts']
    const result = await scanProject({ project, profileId: 'profile-1', globalHardExcludes: [] })
    expect(result.nodes.some((node) => node.relativePath.includes('node_modules'))).toBe(false)
    expect(
      result.nodes.find((node) => node.relativePath === 'src/soft.ts')?.selectedByDefault
    ).toBe(true)
    expect(result.nodes.find((node) => node.relativePath === 'image.png')).toMatchObject({
      binary: true,
      selectable: false
    })
  })

  it('does not traverse a junction whose target is outside the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-link-root-'))
    const external = await mkdtemp(path.join(os.tmpdir(), 'pttm-link-external-'))
    await writeFile(path.join(external, 'secret.ts'), 'outside')
    try {
      await symlink(external, path.join(root, 'external-link'), 'junction')
    } catch {
      return
    }
    const result = await scanProject({
      project: projectFixture(root),
      profileId: 'profile-1',
      globalHardExcludes: []
    })
    expect(result.nodes.some((node) => node.relativePath.includes('secret.ts'))).toBe(false)
    expect(result.warnings.some((warning) => warning.includes('External link ignored'))).toBe(true)
  })
})

describe('preflight and conversion', () => {
  it('warns about secrets without altering source content and writes deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-convert-'))
    const output = path.join(root, 'out')
    const sourcePath = path.join(root, 'source.ts')
    const source = "const apiKey = '123456789-secret-value'\r\n\r\nconsole.log(apiKey)"
    await writeFile(sourcePath, source, 'utf8')
    const sourceStat = await stat(sourcePath)
    const project = projectFixture(root)
    const request: ConversionRequest = {
      projectId: project.id,
      profileId: 'profile-1',
      selectedFiles: [
        { relativePath: 'source.ts', size: sourceStat.size, mtimeMs: sourceStat.mtimeMs }
      ],
      format: 'markdown',
      filename: 'context',
      overwrite: false
    }
    const preflight = await new PreflightService().run(configFixture(project, output), request)
    expect(preflight.valid).toBe(true)
    expect(preflight.issues.some((issue) => issue.code === 'secret')).toBe(true)
    await convertToFile(project, request, preflight.outputPath, {
      signal: new AbortController().signal,
      log: () => undefined,
      progress: () => undefined
    })
    const document = await readFile(preflight.outputPath, 'utf8')
    expect(document).toContain(source)
    expect(document).not.toContain(root)
    expect(document).toContain('source.ts')
  })

  it('decodes a common alternative encoding without corruption', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-encoding-'))
    const sourcePath = path.join(root, 'legacy.txt')
    const source = 'café — résumé'
    await writeFile(sourcePath, iconv.encode(source, 'windows-1252'))
    const sourceStat = await stat(sourcePath)
    const project = projectFixture(root)
    const request: ConversionRequest = {
      projectId: project.id,
      profileId: 'profile-1',
      selectedFiles: [
        { relativePath: 'legacy.txt', size: sourceStat.size, mtimeMs: sourceStat.mtimeMs }
      ],
      format: 'txt',
      filename: 'legacy',
      overwrite: false
    }
    const target = path.join(root, 'legacy-output.txt')
    await convertToFile(project, request, target, {
      signal: new AbortController().signal,
      log: () => undefined,
      progress: () => undefined
    })
    expect(await readFile(target, 'utf8')).toContain(source)
  })

  it('atomically replaces an approved existing output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-overwrite-'))
    const sourcePath = path.join(root, 'source.txt')
    const target = path.join(root, 'context.txt')
    await writeFile(sourcePath, 'new source content')
    await writeFile(target, 'previous output')
    const sourceStat = await stat(sourcePath)
    const project = projectFixture(root)
    const request: ConversionRequest = {
      projectId: project.id,
      profileId: 'profile-1',
      selectedFiles: [
        { relativePath: 'source.txt', size: sourceStat.size, mtimeMs: sourceStat.mtimeMs }
      ],
      format: 'txt',
      filename: 'context',
      overwrite: true
    }
    await convertToFile(project, request, target, {
      signal: new AbortController().signal,
      log: () => undefined,
      progress: () => undefined
    })
    expect(await readFile(target, 'utf8')).toContain('new source content')
  })
  it('blocks conversion when the scan baseline has changed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-baseline-'))
    const sourcePath = path.join(root, 'source.ts')
    await writeFile(sourcePath, 'before')
    const first = await stat(sourcePath)
    await writeFile(sourcePath, 'after-change')
    const project = projectFixture(root)
    const request: ConversionRequest = {
      projectId: project.id,
      profileId: 'profile-1',
      selectedFiles: [{ relativePath: 'source.ts', size: first.size, mtimeMs: first.mtimeMs }],
      format: 'txt',
      filename: 'context',
      overwrite: false
    }
    const result = await new PreflightService().run(
      configFixture(project, path.join(root, 'out')),
      request
    )
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'changed')).toBe(true)
  })
})
