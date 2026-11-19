import { describe, expect, it, vi } from 'vitest'
import type {
  AppConfig,
  ConversionRequest,
  ConversionTask,
  Project,
  ScanResult
} from '../src/shared/model'
import { APP_CONFIG_VERSION } from '../src/shared/model'
import { projectScanSchema } from '../src/shared/ipc'
import {
  batchNeedsCollisionChoice,
  batchSelectionOverride,
  orderedProjects,
  prepareBatchRow,
  queuePreparedBatch,
  reconcileBatchRows,
  runWithConcurrency,
  type BatchRowState,
  type PreparedBatchSnapshot
} from '../src/renderer/src/store/batch-conversion'

const project = (id: string, groupId: string | null, order: number): Project => ({
  id,
  displayName: id,
  path: `C:\\Projects\\${id}`,
  canonicalPath: `c:\\projects\\${id}`,
  framework: 'generic',
  groupId,
  order,
  profiles: [
    {
      id: `${id}-default`,
      name: 'Default',
      presetVersion: 1,
      selection: { manualIncludes: [], manualExcludes: [] }
    },
    {
      id: `${id}-api`,
      name: 'API',
      presetVersion: 1,
      selection: { manualIncludes: ['src/api'], manualExcludes: [] }
    }
  ],
  activeProfileId: `${id}-api`,
  hardExcludes: [],
  customOutputBasename: null
})

const configFixture = (): AppConfig => ({
  schemaVersion: APP_CONFIG_VERSION,
  groups: [
    { id: 'group-b', name: 'B', order: 1 },
    { id: 'group-a', name: 'A', order: 0 }
  ],
  projects: [
    project('ungrouped', null, 0),
    project('second', 'group-a', 1),
    project('first', 'group-a', 0),
    project('last', 'group-b', 0)
  ],
  retainedProjectConfigs: [],
  settings: {
    outputDirectory: 'C:\\Output',
    showHiddenFiles: true,
    watcherEnabled: true,
    notificationsEnabled: false,
    taskConcurrency: 2,
    existingOutputBehavior: 'ask',
    globalHardExcludes: [],
    checkForUpdatesOnStartup: false
  }
})

const rowFixture = (projectId = 'first'): BatchRowState => ({
  projectId,
  selected: true,
  profileId: `${projectId}-api`,
  format: 'markdown',
  basename: `${projectId}-API`,
  basenameCustomized: false,
  status: 'idle',
  revision: 0
})

const scanFixture = (projectId = 'first'): ScanResult => ({
  projectId,
  scannedAt: new Date(0).toISOString(),
  warnings: [],
  nodes: [
    {
      id: 'src/api/index.ts',
      relativePath: 'src/api/index.ts',
      name: 'index.ts',
      parentPath: 'src/api',
      kind: 'file',
      depth: 2,
      size: 12,
      mtimeMs: 20,
      hidden: false,
      binary: false,
      symlink: false,
      selectable: true,
      selectedByDefault: true
    }
  ]
})

const taskFixture = (request: ConversionRequest, id: string): ConversionTask => ({
  id,
  projectId: request.projectId,
  projectName: request.projectId,
  profileName: request.profileId,
  status: 'queued',
  progress: 0,
  processedCount: 0,
  totalCount: request.selectedFiles.length,
  createdAt: new Date(0).toISOString(),
  logs: []
})

describe('batch conversion state', () => {
  it('orders projects by group and project order, with ungrouped last', () => {
    expect(orderedProjects(configFixture()).map((item) => item.id)).toEqual([
      'first',
      'second',
      'last',
      'ungrouped'
    ])
  })

  it('initializes rows unselected with each active profile and preserves session choices', () => {
    const config = configFixture()
    const initial = reconcileBatchRows({
      config,
      availability: {},
      output: {},
      current: {}
    })
    expect(initial.first).toMatchObject({
      selected: false,
      profileId: 'first-api',
      format: 'markdown',
      basename: 'first-API',
      status: 'idle'
    })
    const current = {
      ...initial,
      first: { ...initial.first!, selected: true, format: 'txt' as const }
    }
    const reconciled = reconcileBatchRows({ config, availability: {}, output: {}, current })
    expect(reconciled.first).toMatchObject({ selected: true, format: 'txt' })
  })

  it('uses a draft selection only when the chosen profile is dirty', () => {
    const draft = { manualIncludes: ['src/live'], manualExcludes: [] }
    const drafts = { 'first:first-api': draft }
    expect(
      batchSelectionOverride({
        projectId: 'first',
        profileId: 'first-api',
        dirtyProfiles: new Set(['first:first-api']),
        draftSelections: drafts
      })
    ).toBe(draft)
    expect(
      batchSelectionOverride({
        projectId: 'first',
        profileId: 'first-api',
        dirtyProfiles: new Set(),
        draftSelections: drafts
      })
    ).toBeUndefined()
  })
})

describe('batch prepare orchestration', () => {
  it('scans with the draft override and snapshots a valid request', async () => {
    const selectionOverride = { manualIncludes: ['src/live'], manualExcludes: [] }
    const scan = vi.fn(async () => scanFixture())
    const preflight = vi.fn(async (request: ConversionRequest) => ({
      valid: true,
      issues: [],
      outputPath: `C:\\Output\\${request.filename}.md`,
      outputExists: false
    }))
    const result = await prepareBatchRow({
      project: configFixture().projects.find((item) => item.id === 'first')!,
      row: rowFixture(),
      selectionOverride,
      api: { scan, preflight }
    })
    expect(scan).toHaveBeenCalledWith({
      projectId: 'first',
      profileId: 'first-api',
      selectionOverride
    })
    expect(result.status).toBe('ready')
    expect(result.prepared?.request.selectedFiles).toEqual([
      { relativePath: 'src/api/index.ts', size: 12, mtimeMs: 20 }
    ])
  })

  it('reports empty selections and output conflicts without enqueueing', async () => {
    const empty = await prepareBatchRow({
      project: configFixture().projects[1]!,
      row: rowFixture(),
      api: {
        scan: async () => ({ ...scanFixture(), nodes: [] }),
        preflight: async () => {
          throw new Error('must not run')
        }
      }
    })
    expect(empty).toMatchObject({ status: 'error' })

    const conflict = await prepareBatchRow({
      project: configFixture().projects[1]!,
      row: rowFixture(),
      api: {
        scan: async () => scanFixture(),
        preflight: async () => ({
          valid: true,
          issues: [],
          outputPath: 'C:\\Output\\first-API.md',
          outputExists: true
        })
      }
    })
    expect(conflict.status).toBe('conflict')
  })

  it('limits prepare workers to two', async () => {
    let running = 0
    let maximum = 0
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      running += 1
      maximum = Math.max(maximum, running)
      await Promise.resolve()
      running -= 1
    })
    expect(maximum).toBe(2)
  })

  it('accepts a validated scan selection override over IPC', () => {
    expect(
      projectScanSchema.parse({
        projectId: 'first',
        profileId: 'first-api',
        selectionOverride: { manualIncludes: ['src/live'], manualExcludes: [] }
      }).selectionOverride
    ).toEqual({ manualIncludes: ['src/live'], manualExcludes: [] })
  })
})

describe('batch queue orchestration', () => {
  const snapshot = (projectId: string, outputExists: boolean): PreparedBatchSnapshot => ({
    request: {
      projectId,
      profileId: `${projectId}-api`,
      selectedFiles: [{ relativePath: 'src/api/index.ts', size: 12, mtimeMs: 20 }],
      format: 'markdown',
      filename: `${projectId}-API`,
      overwrite: false
    },
    preflight: {
      valid: true,
      issues: [],
      outputPath: `C:\\Output\\${projectId}-API.md`,
      outputExists
    },
    scanWarnings: []
  })

  it('counts conflicts and applies one overwrite choice while preserving partial success', async () => {
    const items = [
      { projectId: 'first', snapshot: snapshot('first', true) },
      { projectId: 'second', snapshot: snapshot('second', false) },
      { projectId: 'last', snapshot: snapshot('last', false) }
    ]
    expect(batchNeedsCollisionChoice(items)).toBe(1)
    const requests: ConversionRequest[] = []
    const result = await queuePreparedBatch(items, 'overwrite', {
      enqueue: async (request) => {
        requests.push(request)
        if (request.projectId === 'second') throw new Error('queue failed')
        return taskFixture(request, `task-${request.projectId}`)
      }
    })
    expect(requests.map((request) => request.overwrite)).toEqual([true, true, true])
    expect(result.queued.map((item) => item.projectId)).toEqual(['first', 'last'])
    expect(result.failed).toEqual([{ projectId: 'second', message: 'queue failed' }])
  })

  it('uses unique filenames by leaving overwrite disabled', async () => {
    const request = snapshot('first', true)
    const enqueue = vi.fn(async (value: ConversionRequest) => taskFixture(value, 'task-first'))
    await queuePreparedBatch([{ projectId: 'first', snapshot: request }], 'unique', { enqueue })
    expect(enqueue.mock.calls[0]?.[0].overwrite).toBe(false)
  })
})
