import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PRESETS } from '../src/shared/presets'
import { matchingManualRule, resolveSelection, setManualSelection } from '../src/shared/selection'
import { defaultOutputBasename, outputFilename, sanitizeOutputBasename } from '../src/shared/output'
import { documentStart, projectTree } from '../src/main/services/document-renderer'
import { OutputReservations } from '../src/main/services/output-reservations'
import { ConfigStore } from '../src/main/services/config-store'
import { APP_CONFIG_VERSION, appConfigSchema, type AppConfig } from '../src/shared/model'

describe('selection precedence', () => {
  it('lets a manual include override both preset and .gitignore exclusions', () => {
    const result = resolveSelection({
      relativePath: '.env.local',
      binary: false,
      gitIgnored: true,
      preset: PRESETS.react,
      selection: { manualIncludes: ['.env.local'], manualExcludes: [] }
    })
    expect(result.selected).toBe(true)
  })

  it('does not exclude sensitive filenames solely because they may contain secrets', () => {
    const result = resolveSelection({
      relativePath: '.env.local',
      binary: false,
      gitIgnored: false,
      preset: PRESETS.generic,
      selection: { manualIncludes: [], manualExcludes: [] }
    })
    expect(result.selected).toBe(true)
  })

  it('never permits a binary file even when manually included', () => {
    const result = resolveSelection({
      relativePath: 'asset.bin',
      binary: true,
      gitIgnored: false,
      preset: PRESETS.generic,
      selection: { manualIncludes: ['asset.bin'], manualExcludes: [] }
    })
    expect(result).toEqual({ selected: false, reason: 'binary' })
  })

  it('uses the most specific folder path rule and removes opposite exact rules', () => {
    expect(matchingManualRule('src/generated/file.ts', ['src', 'src/generated'])).toBe(
      'src/generated'
    )
    const selected = setManualSelection(
      { manualIncludes: [], manualExcludes: ['src'] },
      'src',
      true
    )
    expect(selected).toEqual({ manualIncludes: ['src'], manualExcludes: [] })
  })
})

describe('output naming and rendering', () => {
  it('sanitizes Windows-invalid names and changes only the requested extension', () => {
    expect(sanitizeOutputBasename('My<Project>:Default.txt')).toBe('My-Project--Default')
    expect(outputFilename('context.txt', 'markdown')).toBe('context.md')
    expect(defaultOutputBasename('HomeXIQ', 'Default')).toBe('HomeXIQ-Default')
  })

  it('renders a stable selected-only tree with portable separators', () => {
    const tree = projectTree('Demo', ['src\\b.ts', 'src/a.ts', 'README.md'])
    expect(tree).toContain('src/')
    expect(tree.indexOf('a.ts')).toBeLessThan(tree.indexOf('b.ts'))
    expect(tree).not.toContain('\\')
    expect(documentStart('markdown', 'Demo', ['src/a.ts'])).toContain('```text')
  })

  it('reserves unique physical targets for parallel conversions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-output-'))
    const requested = path.join(root, 'project.md')
    await writeFile(requested, 'existing')
    const reservations = new OutputReservations()
    const first = await reservations.reserve(requested, false)
    const second = await reservations.reserve(requested, false)
    expect(path.basename(first)).toBe('project (1).md')
    expect(path.basename(second)).toBe('project (2).md')
  })
})

describe('versioned configuration store', () => {
  const importedConfig = (outputDirectory = 'C:\\Output'): AppConfig => ({
    schemaVersion: APP_CONFIG_VERSION,
    groups: [{ id: 'group-1', name: 'Group 1', order: 0 }],
    projects: [
      {
        id: 'project-1',
        displayName: 'Demo',
        path: 'C:\\Projects\\Demo',
        canonicalPath: 'C:\\Projects\\Demo',
        framework: 'react' as const,
        groupId: 'group-1',
        order: 0,
        profiles: [
          {
            id: 'profile-1',
            name: 'Default',
            presetVersion: 1,
            selection: { manualIncludes: ['src'], manualExcludes: [] }
          }
        ],
        activeProfileId: 'profile-1',
        hardExcludes: ['coverage'],
        customOutputBasename: null
      }
    ],
    retainedProjectConfigs: [],
    settings: {
      outputDirectory,
      showHiddenFiles: false,
      watcherEnabled: false,
      notificationsEnabled: false,
      taskConcurrency: 3 as const,
      existingOutputBehavior: 'unique',
      globalHardExcludes: ['tmp'],
      checkForUpdatesOnStartup: false
    }
  })

  it('preserves corrupt JSON until the user chooses a recovery action', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-config-'))
    const configPath = path.join(root, 'config.json')
    const sessionPath = path.join(root, 'session.json')
    await writeFile(configPath, '{broken')
    const store = new ConfigStore(configPath, sessionPath, path.join(root, 'output'))
    const loaded = await store.load()
    expect(loaded.recoveryRequired).toBe(true)
    expect(loaded.recoveryMessage).toContain('original file was preserved')
    expect(loaded.config.schemaVersion).toBe(APP_CONFIG_VERSION)
    expect(loaded.config.projects).toEqual([])
    expect(await readFile(configPath, 'utf8')).toBe('{broken')
    await expect(store.save(loaded.config)).rejects.toThrow('Resolve configuration recovery')

    const reset = await store.resetLocalData()
    expect(reset.projects).toEqual([])
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as { schemaVersion: number }
    expect(stored.schemaVersion).toBe(APP_CONFIG_VERSION)
  })

  it('rejects imported configuration with an unknown schema version', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-import-'))
    await mkdir(root, { recursive: true })
    const store = new ConfigStore(
      path.join(root, 'config.json'),
      path.join(root, 'session.json'),
      path.join(root, 'out')
    )
    await expect(
      store.replaceImported({
        schemaVersion: 999,
        groups: [],
        projects: [],
        retainedProjectConfigs: [],
        settings: {}
      })
    ).rejects.toThrow()
  })

  it('rejects unsafe absolute and traversal paths in imported configuration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-import-paths-'))
    const store = new ConfigStore(
      path.join(root, 'config.json'),
      path.join(root, 'session.json'),
      path.join(root, 'out')
    )
    await expect(store.replaceImported(importedConfig('relative-output'))).rejects.toThrow(
      'absolute Windows path'
    )
    const traversing = importedConfig()
    traversing.projects[0]!.profiles[0]!.selection.manualIncludes = ['../outside']
    await expect(store.replaceImported(traversing)).rejects.toThrow('parent traversal')
  })

  it('resets application settings while preserving projects, groups and profiles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pttm-reset-settings-'))
    const defaultOutput = 'C:\\Default Output'
    const store = new ConfigStore(
      path.join(root, 'config.json'),
      path.join(root, 'session.json'),
      defaultOutput
    )
    const imported = await store.replaceImported(importedConfig())
    const reset = await store.resetSettings()
    expect(reset.groups).toEqual(imported.groups)
    expect(reset.projects).toEqual(imported.projects)
    expect(reset.settings.outputDirectory).toBe(defaultOutput)
    expect(reset.settings.showHiddenFiles).toBe(true)
    expect(reset.settings.taskConcurrency).toBe('auto')
    expect(reset.settings.existingOutputBehavior).toBe('ask')
  })

  it('defaults the output collision behavior for older configurations', () => {
    const legacy = importedConfig()
    delete (legacy.settings as Partial<AppConfig['settings']>).existingOutputBehavior

    expect(appConfigSchema.parse(legacy).settings.existingOutputBehavior).toBe('ask')
  })
})
