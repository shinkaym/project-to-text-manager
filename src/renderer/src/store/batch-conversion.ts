import type {
  AppConfig,
  ConversionRequest,
  ConversionTask,
  OutputFormat,
  PreflightResult,
  Project,
  ScanResult,
  Selection
} from '../../../shared/model'
import { defaultOutputBasename } from '../../../shared/output'

export type BatchPrepareStatus =
  'idle' | 'preparing' | 'ready' | 'warning' | 'conflict' | 'error' | 'queued'

export type PreparedBatchSnapshot = {
  request: ConversionRequest
  preflight: PreflightResult
  scanWarnings: string[]
}

export type BatchRowState = {
  projectId: string
  selected: boolean
  profileId: string
  format: OutputFormat
  basename: string
  basenameCustomized: boolean
  status: BatchPrepareStatus
  revision: number
  prepared?: PreparedBatchSnapshot
  error?: string
  taskId?: string
}

export type BatchBanner = {
  queued: number
  failed: number
  message: string
} | null

export type BatchPrepareApi = {
  scan(input: {
    projectId: string
    profileId: string
    selectionOverride?: Selection
  }): Promise<ScanResult>
  preflight(request: ConversionRequest): Promise<PreflightResult>
}

export type BatchQueueApi = {
  enqueue(request: ConversionRequest): Promise<ConversionTask>
}

export type BatchQueueItem = {
  projectId: string
  snapshot: PreparedBatchSnapshot
}

export type BatchQueueResult = {
  queued: Array<{ projectId: string; taskId: string }>
  failed: Array<{ projectId: string; message: string }>
}

type OutputDefaults = Record<
  string,
  { format: OutputFormat; basename: string; customized: boolean } | undefined
>

export function orderedProjects(config: AppConfig): Project[] {
  const groups = [...config.groups].sort((a, b) => a.order - b.order)
  const projectsFor = (groupId: string | null): Project[] =>
    [...config.projects.filter((project) => project.groupId === groupId)].sort(
      (a, b) => a.order - b.order
    )
  return [...groups.flatMap((group) => projectsFor(group.id)), ...projectsFor(null)]
}

export function reconcileBatchRows(input: {
  config: AppConfig
  availability: Record<string, boolean>
  output: OutputDefaults
  current: Record<string, BatchRowState>
  invalidatePrepared?: boolean
}): Record<string, BatchRowState> {
  const next: Record<string, BatchRowState> = {}
  for (const project of orderedProjects(input.config)) {
    const existing = input.current[project.id]
    const existingProfile = existing
      ? project.profiles.find((profile) => profile.id === existing.profileId)
      : undefined
    const profile =
      existingProfile ?? project.profiles.find((item) => item.id === project.activeProfileId)!
    const output = input.output[project.id]
    const available = input.availability[project.id] !== false
    const profileChanged = !!existing && !existingProfile
    const shouldInvalidate = input.invalidatePrepared === true || profileChanged || !available
    if (!existing) {
      next[project.id] = {
        projectId: project.id,
        selected: false,
        profileId: profile.id,
        format: output?.format ?? 'markdown',
        basename:
          project.customOutputBasename ??
          output?.basename ??
          defaultOutputBasename(project.displayName, profile.name),
        basenameCustomized: !!project.customOutputBasename || output?.customized === true,
        status: available ? 'idle' : 'error',
        revision: 0,
        error: available ? undefined : 'Project unavailable'
      }
      continue
    }
    const basename = profileChanged
      ? (project.customOutputBasename ?? defaultOutputBasename(project.displayName, profile.name))
      : existing.basename
    next[project.id] = {
      ...existing,
      selected: available ? existing.selected : false,
      profileId: profile.id,
      basename,
      basenameCustomized: profileChanged
        ? !!project.customOutputBasename
        : existing.basenameCustomized,
      status: shouldInvalidate ? (available ? 'idle' : 'error') : existing.status,
      revision: shouldInvalidate ? existing.revision + 1 : existing.revision,
      prepared: shouldInvalidate ? undefined : existing.prepared,
      error: shouldInvalidate ? (available ? undefined : 'Project unavailable') : existing.error,
      taskId: shouldInvalidate ? undefined : existing.taskId
    }
  }
  return next
}

export function invalidateBatchRow(row: BatchRowState): BatchRowState {
  return {
    ...row,
    status: 'idle',
    revision: row.revision + 1,
    prepared: undefined,
    error: undefined,
    taskId: undefined
  }
}

export function batchSelectionOverride(input: {
  projectId: string
  profileId: string
  dirtyProfiles: Set<string>
  draftSelections: Record<string, Selection>
}): Selection | undefined {
  const key = `${input.projectId}:${input.profileId}`
  return input.dirtyProfiles.has(key) ? input.draftSelections[key] : undefined
}

export async function prepareBatchRow(input: {
  project: Project
  row: BatchRowState
  selectionOverride?: Selection
  api: BatchPrepareApi
}): Promise<Pick<BatchRowState, 'status' | 'prepared' | 'error'>> {
  const filename = input.row.basename.trim()
  if (!filename) return { status: 'error', error: 'Output filename is required.' }
  const scan = await input.api.scan({
    projectId: input.project.id,
    profileId: input.row.profileId,
    selectionOverride: input.selectionOverride
  })
  const selectedFiles = scan.nodes
    .filter((node) => node.kind === 'file' && node.selectedByDefault)
    .map((node) => ({
      relativePath: node.relativePath,
      size: node.size,
      mtimeMs: node.mtimeMs
    }))
  if (selectedFiles.length === 0)
    return { status: 'error', error: 'The selected profile does not include any files.' }
  const request: ConversionRequest = {
    projectId: input.project.id,
    profileId: input.row.profileId,
    selectedFiles,
    format: input.row.format,
    filename,
    overwrite: false
  }
  const preflight = await input.api.preflight(request)
  const snapshot: PreparedBatchSnapshot = {
    request: structuredClone(request),
    preflight: structuredClone(preflight),
    scanWarnings: [...scan.warnings]
  }
  if (!preflight.valid) {
    const message = preflight.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message)
      .join('; ')
    return { status: 'error', prepared: snapshot, error: message || 'Preflight failed.' }
  }
  if (preflight.outputExists) return { status: 'conflict', prepared: snapshot }
  if (scan.warnings.length > 0 || preflight.issues.some((issue) => issue.severity === 'warning'))
    return { status: 'warning', prepared: snapshot }
  return { status: 'ready', prepared: snapshot }
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  const next = async (): Promise<void> => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      if (current !== undefined) await worker(current)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, next))
}

export function batchNeedsCollisionChoice(items: readonly BatchQueueItem[]): number {
  return items.filter((item) => item.snapshot.preflight.outputExists).length
}

export async function queuePreparedBatch(
  items: readonly BatchQueueItem[],
  behavior: 'overwrite' | 'unique',
  api: BatchQueueApi
): Promise<BatchQueueResult> {
  const result: BatchQueueResult = { queued: [], failed: [] }
  for (const item of items) {
    try {
      const task = await api.enqueue({
        ...structuredClone(item.snapshot.request),
        overwrite: behavior === 'overwrite'
      })
      result.queued.push({ projectId: item.projectId, taskId: task.id })
    } catch (error) {
      result.failed.push({ projectId: item.projectId, message: (error as Error).message })
    }
  }
  return result
}
