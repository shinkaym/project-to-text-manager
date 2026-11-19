import { create } from 'zustand'
import type {
  AppConfig,
  ConversionTask,
  FileTreeNode,
  FrameworkId,
  LayoutState,
  OutputFormat,
  PickedProject,
  PreflightResult,
  Project,
  ScanResult,
  Selection,
  SessionState,
  UpdateState
} from '../../../shared/model'
import { APP_CONFIG_VERSION, defaultSession } from '../../../shared/model'
import { defaultOutputBasename } from '../../../shared/output'
import { setManualSelection } from '../../../shared/selection'
import {
  batchNeedsCollisionChoice,
  batchSelectionOverride,
  invalidateBatchRow,
  orderedProjects,
  prepareBatchRow,
  queuePreparedBatch,
  reconcileBatchRows,
  runWithConcurrency,
  type BatchBanner,
  type BatchRowState
} from './batch-conversion'

export type Activity = 'projects' | 'batch' | 'tasks' | 'settings'
type ScanState = {
  status: 'idle' | 'scanning' | 'ready' | 'error'
  nodes: FileTreeNode[]
  warnings: string[]
  error?: string
}
type OutputState = { format: OutputFormat; basename: string; customized: boolean }

type AppState = {
  initialized: boolean
  config: AppConfig | null
  session: SessionState
  activity: Activity
  availability: Record<string, boolean>
  scans: Record<string, ScanState>
  selectedPaths: Record<string, Set<string>>
  draftSelections: Record<string, Selection>
  dirtyProfiles: Set<string>
  output: Record<string, OutputState>
  batchRows: Record<string, BatchRowState>
  batchBanner: BatchBanner
  batchQueueing: boolean
  tasks: ConversionTask[]
  update: UpdateState | null
  message: string | null
  recoveryRequired: boolean
  recoveryMessage: string | null
  initialize(): Promise<void>
  setActivity(value: Activity): void
  setMessage(value: string | null): void
  setConfig(config: AppConfig): void
  saveConfig(config: AppConfig): Promise<void>
  mutateConfig(mutator: (config: AppConfig) => void): Promise<void>
  openProject(projectId: string): Promise<void>
  focusProject(projectId: string): Promise<void>
  closeProject(projectId: string): Promise<void>
  scanProject(projectId: string, preserveSelection?: boolean): Promise<void>
  togglePath(projectId: string, relativePath: string, selected: boolean): void
  saveProfile(projectId: string, profileId: string): Promise<void>
  discardProfile(projectId: string, profileId: string): Promise<void>
  saveAllDirty(): Promise<void>
  setActiveProfile(projectId: string, profileId: string): Promise<void>
  setOutputFormat(projectId: string, format: OutputFormat): void
  setOutputBasename(projectId: string, basename: string, customized?: boolean): void
  setLayout(patch: Partial<LayoutState>): Promise<void>
  syncWatcher(): Promise<void>
  convert(projectId: string, overwrite?: boolean, allowUnique?: boolean): Promise<PreflightResult>
  initializeBatchRows(): void
  setBatchSelected(projectId: string, selected: boolean): void
  setBatchSelectedMany(projectIds: string[], selected: boolean): void
  setBatchProfile(projectId: string, profileId: string): void
  setBatchFormat(projectId: string, format: OutputFormat): void
  setBatchBasename(projectId: string, basename: string): void
  prepareBatch(): Promise<void>
  queueBatch(behavior?: 'overwrite' | 'unique'): Promise<{
    requiresCollisionChoice: number
    queued: number
    failed: number
  }>
  dismissBatchBanner(): void
  addPickedProject(
    picked: PickedProject,
    framework: FrameworkId,
    groupId: string | null
  ): Promise<string>
}

const profileKey = (projectId: string, profileId: string): string => `${projectId}:${profileId}`
let configMutationQueue: Promise<void> = Promise.resolve()
let initializationPromise: Promise<void> | null = null

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  config: null,
  session: defaultSession(),
  activity: 'projects',
  availability: {},
  scans: {},
  selectedPaths: {},
  draftSelections: {},
  dirtyProfiles: new Set(),
  output: {},
  batchRows: {},
  batchBanner: null,
  batchQueueing: false,
  tasks: [],
  update: null,
  message: null,
  recoveryRequired: false,
  recoveryMessage: null,

  async initialize() {
    if (get().initialized) return
    if (!initializationPromise) {
      initializationPromise = (async () => {
        const [loaded, session, tasks, availability] = await Promise.all([
          window.desktop.config.load(),
          window.desktop.session.load(),
          window.desktop.conversion.list(),
          window.desktop.projects.refreshAvailability()
        ])
        const projectIds = new Set(loaded.config.projects.map((project) => project.id))
        const openProjectIds = session.openProjectIds.filter((id) => projectIds.has(id))
        const activeProjectId =
          session.activeProjectId && openProjectIds.includes(session.activeProjectId)
            ? session.activeProjectId
            : (openProjectIds[0] ?? null)
        const restored = { ...session, openProjectIds, activeProjectId }
        set({
          initialized: true,
          config: loaded.config,
          session: restored,
          tasks,
          availability,
          recoveryRequired: loaded.recoveryRequired === true,
          recoveryMessage: loaded.recoveryMessage ?? null
        })
        await window.desktop.watcher.sync(openProjectIds)
        if (activeProjectId) await get().scanProject(activeProjectId)
        for (const projectId of openProjectIds.filter((id) => id !== activeProjectId))
          void get().scanProject(projectId)
      })()
    }
    try {
      await initializationPromise
    } finally {
      initializationPromise = null
    }
  },
  setActivity: (activity) => {
    set({ activity })
    if (activity === 'batch') get().initializeBatchRows()
  },
  setMessage: (message) => set({ message }),
  setConfig: (config) =>
    set((state) => ({
      config,
      batchRows: reconcileBatchRows({
        config,
        availability: state.availability,
        output: state.output,
        current: state.batchRows,
        invalidatePrepared: true
      })
    })),
  async saveConfig(config) {
    get().setConfig(await window.desktop.config.save(config))
  },
  async mutateConfig(mutator) {
    const operation = configMutationQueue
      .catch(() => undefined)
      .then(async () => {
        const config = get().config
        if (!config) return
        const draft = structuredClone(config)
        mutator(draft)
        await get().saveConfig(draft)
      })
    configMutationQueue = operation.catch(() => undefined)
    return operation
  },
  async openProject(projectId) {
    const session = get().session
    const openProjectIds = session.openProjectIds.includes(projectId)
      ? session.openProjectIds
      : [...session.openProjectIds, projectId]
    const next = { ...session, openProjectIds, activeProjectId: projectId }
    set({ session: next, activity: 'projects' })
    await window.desktop.session.save(next)
    await get().syncWatcher()
    if (!get().scans[projectId] || get().scans[projectId]?.status === 'error')
      await get().scanProject(projectId)
  },
  async focusProject(projectId) {
    const next = { ...get().session, activeProjectId: projectId }
    set({ session: next, activity: 'projects' })
    await window.desktop.session.save(next)
  },
  async closeProject(projectId) {
    const session = get().session
    const openProjectIds = session.openProjectIds.filter((id) => id !== projectId)
    const activeProjectId =
      session.activeProjectId === projectId
        ? (openProjectIds.at(-1) ?? null)
        : session.activeProjectId
    const next = { ...session, openProjectIds, activeProjectId }
    set({ session: next })
    await window.desktop.session.save(next)
    await get().syncWatcher()
  },
  async scanProject(projectId, preserveSelection = false) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    set((state) => ({
      scans: {
        ...state.scans,
        [projectId]: {
          status: 'scanning',
          nodes: state.scans[projectId]?.nodes ?? [],
          warnings: []
        }
      }
    }))
    try {
      const result: ScanResult = await window.desktop.projects.scan({
        projectId,
        profileId: project.activeProfileId
      })
      const oldSelected = get().selectedPaths[projectId]
      const oldNodes = new Set(get().scans[projectId]?.nodes.map((node) => node.relativePath) ?? [])
      const selected = new Set(
        result.nodes
          .filter((node) => node.kind === 'file' && node.selectedByDefault)
          .map((node) => node.relativePath)
      )
      if (preserveSelection && oldSelected) {
        for (const node of result.nodes) {
          if (node.kind !== 'file' || !oldNodes.has(node.relativePath)) continue
          oldSelected.has(node.relativePath)
            ? selected.add(node.relativePath)
            : selected.delete(node.relativePath)
        }
      }
      const key = profileKey(projectId, project.activeProfileId)
      const profile = project.profiles.find(
        (candidate) => candidate.id === project.activeProfileId
      )!
      set((state) => ({
        scans: {
          ...state.scans,
          [projectId]: { status: 'ready', nodes: result.nodes, warnings: result.warnings }
        },
        selectedPaths: { ...state.selectedPaths, [projectId]: selected },
        draftSelections: {
          ...state.draftSelections,
          [key]: state.draftSelections[key] ?? structuredClone(profile.selection)
        }
      }))
    } catch (error) {
      set((state) => ({
        scans: {
          ...state.scans,
          [projectId]: { status: 'error', nodes: [], warnings: [], error: (error as Error).message }
        }
      }))
    }
  },
  togglePath(projectId, relativePath, selected) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    const scan = get().scans[projectId]
    if (!project || !scan) return
    const profileId = project.activeProfileId
    const key = profileKey(projectId, profileId)
    const current = get().selectedPaths[projectId] ?? new Set<string>()
    const next = new Set(current)
    const target = scan.nodes.find((node) => node.relativePath === relativePath)
    if (!target) return
    const affected =
      target.kind === 'directory'
        ? scan.nodes.filter(
            (node) =>
              node.kind === 'file' &&
              node.selectable &&
              node.relativePath.startsWith(`${relativePath}/`)
          )
        : [target]
    for (const node of affected)
      selected ? next.add(node.relativePath) : next.delete(node.relativePath)
    const profile = project.profiles.find((candidate) => candidate.id === profileId)!
    const draft = get().draftSelections[key] ?? structuredClone(profile.selection)
    set((state) => ({
      selectedPaths: { ...state.selectedPaths, [projectId]: next },
      draftSelections: {
        ...state.draftSelections,
        [key]: setManualSelection(draft, relativePath, selected)
      },
      dirtyProfiles: new Set(state.dirtyProfiles).add(key),
      batchRows: state.batchRows[projectId]
        ? {
            ...state.batchRows,
            [projectId]:
              state.batchRows[projectId]!.profileId === profileId
                ? invalidateBatchRow(state.batchRows[projectId]!)
                : state.batchRows[projectId]!
          }
        : state.batchRows
    }))
  },
  async saveProfile(projectId, profileId) {
    const key = profileKey(projectId, profileId)
    const selection = get().draftSelections[key]
    if (!selection) return
    await get().mutateConfig((config) => {
      const profile = config.projects
        .find((project) => project.id === projectId)
        ?.profiles.find((candidate) => candidate.id === profileId)
      if (profile) profile.selection = structuredClone(selection)
    })
    set((state) => {
      const dirtyProfiles = new Set(state.dirtyProfiles)
      dirtyProfiles.delete(key)
      return { dirtyProfiles }
    })
  },
  async discardProfile(projectId, profileId) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    const profile = project?.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) return
    const key = profileKey(projectId, profileId)
    set((state) => {
      const dirtyProfiles = new Set(state.dirtyProfiles)
      dirtyProfiles.delete(key)
      return {
        dirtyProfiles,
        draftSelections: { ...state.draftSelections, [key]: structuredClone(profile.selection) },
        batchRows: state.batchRows[projectId]
          ? {
              ...state.batchRows,
              [projectId]:
                state.batchRows[projectId]!.profileId === profileId
                  ? invalidateBatchRow(state.batchRows[projectId]!)
                  : state.batchRows[projectId]!
            }
          : state.batchRows
      }
    })
    await get().scanProject(projectId)
  },
  async saveAllDirty() {
    for (const key of [...get().dirtyProfiles]) {
      const [projectId, profileId] = key.split(':')
      if (projectId && profileId) await get().saveProfile(projectId, profileId)
    }
  },
  async setActiveProfile(projectId, profileId) {
    await get().mutateConfig((config) => {
      const project = config.projects.find((candidate) => candidate.id === projectId)
      if (project?.profiles.some((profile) => profile.id === profileId))
        project.activeProfileId = profileId
    })
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    const profile = project?.profiles.find((candidate) => candidate.id === profileId)
    const output = get().output[projectId]
    if (project && profile && !output?.customized)
      get().setOutputBasename(
        projectId,
        defaultOutputBasename(project.displayName, profile.name),
        false
      )
    await get().scanProject(projectId)
  },
  setOutputFormat(projectId, format) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    const profile = project.profiles.find((candidate) => candidate.id === project.activeProfileId)!
    const current = get().output[projectId] ?? {
      format: 'markdown' as const,
      basename:
        project.customOutputBasename ?? defaultOutputBasename(project.displayName, profile.name),
      customized: !!project.customOutputBasename
    }
    set((state) => ({ output: { ...state.output, [projectId]: { ...current, format } } }))
  },
  setOutputBasename(projectId, basename, customized = true) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    const profile = project.profiles.find((candidate) => candidate.id === project.activeProfileId)!
    const current = get().output[projectId] ?? {
      format: 'markdown' as const,
      basename: defaultOutputBasename(project.displayName, profile.name),
      customized: false
    }
    set((state) => ({
      output: { ...state.output, [projectId]: { ...current, basename, customized } }
    }))
    if (customized)
      void get().mutateConfig((config) => {
        const item = config.projects.find((candidate) => candidate.id === projectId)
        if (item) item.customOutputBasename = basename
      })
  },
  async setLayout(patch) {
    const next = { ...get().session, layout: { ...get().session.layout, ...patch } }
    set({ session: next })
    await window.desktop.session.save(next)
  },
  async syncWatcher() {
    await window.desktop.watcher.sync(get().session.openProjectIds)
  },
  async convert(projectId, overwrite = false, allowUnique = false) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    const scan = get().scans[projectId]
    if (!project || !scan) throw new Error('Project is not ready')
    const profile = project.profiles.find((candidate) => candidate.id === project.activeProfileId)!
    const output = get().output[projectId] ?? {
      format: 'markdown' as const,
      basename:
        project.customOutputBasename ?? defaultOutputBasename(project.displayName, profile.name),
      customized: !!project.customOutputBasename
    }
    const selected = get().selectedPaths[projectId] ?? new Set()
    const request = {
      projectId,
      profileId: profile.id,
      format: output.format,
      filename: output.basename,
      overwrite,
      selectedFiles: scan.nodes
        .filter((node) => node.kind === 'file' && selected.has(node.relativePath))
        .map((node) => ({
          relativePath: node.relativePath,
          size: node.size,
          mtimeMs: node.mtimeMs
        }))
    }
    const preflight = await window.desktop.conversion.preflight(request)
    if (preflight.valid && (!preflight.outputExists || overwrite || allowUnique))
      await window.desktop.conversion.enqueue(request)
    return preflight
  },
  initializeBatchRows() {
    const state = get()
    if (!state.config) return
    set({
      batchRows: reconcileBatchRows({
        config: state.config,
        availability: state.availability,
        output: state.output,
        current: state.batchRows
      })
    })
  },
  setBatchSelected(projectId, selected) {
    set((state) => {
      const row = state.batchRows[projectId]
      if (!row || state.availability[projectId] === false) return state
      return { batchRows: { ...state.batchRows, [projectId]: { ...row, selected } } }
    })
  },
  setBatchSelectedMany(projectIds, selected) {
    set((state) => {
      const batchRows = { ...state.batchRows }
      for (const projectId of projectIds) {
        const row = batchRows[projectId]
        if (row && state.availability[projectId] !== false)
          batchRows[projectId] = { ...row, selected }
      }
      return { batchRows }
    })
  },
  setBatchProfile(projectId, profileId) {
    const project = get().config?.projects.find((candidate) => candidate.id === projectId)
    const profile = project?.profiles.find((candidate) => candidate.id === profileId)
    if (!project || !profile) return
    set((state) => {
      const row = state.batchRows[projectId]
      if (!row || row.profileId === profileId) return state
      const invalidated = invalidateBatchRow(row)
      return {
        batchRows: {
          ...state.batchRows,
          [projectId]: {
            ...invalidated,
            profileId,
            basename: row.basenameCustomized
              ? row.basename
              : defaultOutputBasename(project.displayName, profile.name)
          }
        }
      }
    })
  },
  setBatchFormat(projectId, format) {
    set((state) => {
      const row = state.batchRows[projectId]
      if (!row || row.format === format) return state
      return {
        batchRows: {
          ...state.batchRows,
          [projectId]: { ...invalidateBatchRow(row), format }
        }
      }
    })
  },
  setBatchBasename(projectId, basename) {
    set((state) => {
      const row = state.batchRows[projectId]
      if (!row || row.basename === basename) return state
      return {
        batchRows: {
          ...state.batchRows,
          [projectId]: {
            ...invalidateBatchRow(row),
            basename,
            basenameCustomized: true
          }
        }
      }
    })
  },
  async prepareBatch() {
    const state = get()
    const config = state.config
    if (!config) return
    const projects = orderedProjects(config).filter((project) => {
      const row = state.batchRows[project.id]
      return row?.selected && state.availability[project.id] !== false
    })
    if (projects.length === 0) return
    set((current) => {
      const batchRows = { ...current.batchRows }
      for (const project of projects) {
        const row = batchRows[project.id]
        if (row)
          batchRows[project.id] = {
            ...row,
            status: 'preparing',
            prepared: undefined,
            error: undefined,
            taskId: undefined
          }
      }
      return { batchRows, batchBanner: null }
    })
    await runWithConcurrency(projects, 2, async (project) => {
      const before = get()
      const row = before.batchRows[project.id]
      if (!row) return
      const revision = row.revision
      const selectionOverride = batchSelectionOverride({
        projectId: project.id,
        profileId: row.profileId,
        dirtyProfiles: before.dirtyProfiles,
        draftSelections: before.draftSelections
      })
      try {
        const result = await prepareBatchRow({
          project,
          row,
          selectionOverride,
          api: {
            scan: (input) => window.desktop.projects.scan(input),
            preflight: (request) => window.desktop.conversion.preflight(request)
          }
        })
        set((current) => {
          const latest = current.batchRows[project.id]
          if (!latest || latest.revision !== revision) return current
          return {
            batchRows: {
              ...current.batchRows,
              [project.id]: { ...latest, ...result }
            }
          }
        })
      } catch (error) {
        set((current) => {
          const latest = current.batchRows[project.id]
          if (!latest || latest.revision !== revision) return current
          return {
            batchRows: {
              ...current.batchRows,
              [project.id]: {
                ...latest,
                status: 'error',
                prepared: undefined,
                error: (error as Error).message
              }
            }
          }
        })
      }
    })
  },
  async queueBatch(behavior) {
    const state = get()
    const config = state.config
    if (!config) return { requiresCollisionChoice: 0, queued: 0, failed: 0 }
    const items = orderedProjects(config).flatMap((project) => {
      const row = state.batchRows[project.id]
      if (!row?.selected || !row.prepared || !['ready', 'warning', 'conflict'].includes(row.status))
        return []
      return [{ projectId: project.id, snapshot: row.prepared }]
    })
    if (items.length === 0) return { requiresCollisionChoice: 0, queued: 0, failed: 0 }
    const setting = config.settings.existingOutputBehavior
    const conflictCount = batchNeedsCollisionChoice(items)
    if (setting === 'ask' && !behavior && conflictCount > 0)
      return { requiresCollisionChoice: conflictCount, queued: 0, failed: 0 }
    const resolvedBehavior = setting === 'ask' ? (behavior ?? 'unique') : setting
    set({ batchQueueing: true, batchBanner: null })
    try {
      const result = await queuePreparedBatch(items, resolvedBehavior, {
        enqueue: (request) => window.desktop.conversion.enqueue(request)
      })
      set((current) => {
        const batchRows = { ...current.batchRows }
        for (const queued of result.queued) {
          const row = batchRows[queued.projectId]
          if (row) batchRows[queued.projectId] = { ...row, status: 'queued', taskId: queued.taskId }
        }
        for (const failed of result.failed) {
          const row = batchRows[failed.projectId]
          if (row)
            batchRows[failed.projectId] = {
              ...row,
              status: 'error',
              error: failed.message,
              taskId: undefined
            }
        }
        const queued = result.queued.length
        const failed = result.failed.length
        return {
          batchRows,
          batchBanner: {
            queued,
            failed,
            message: `${queued} task${queued === 1 ? '' : 's'} queued${failed ? `; ${failed} failed to queue` : ''}.`
          }
        }
      })
      return {
        requiresCollisionChoice: 0,
        queued: result.queued.length,
        failed: result.failed.length
      }
    } finally {
      set({ batchQueueing: false })
    }
  },
  dismissBatchBanner: () => set({ batchBanner: null }),
  async addPickedProject(picked, framework, groupId) {
    const before = new Set(get().config?.projects.map((project) => project.id) ?? [])
    const config = await window.desktop.projects.add({ token: picked.token, framework, groupId })
    get().setConfig(config)
    const added = config.projects.find((project) => !before.has(project.id))
    if (!added) throw new Error('Project was not added')
    await get().openProject(added.id)
    return added.id
  }
}))

export const activeProjectSelector = (state: AppState): Project | null =>
  state.config?.projects.find((project) => project.id === state.session.activeProjectId) ?? null
export const activeProfileDirty = (
  state: AppState,
  projectId: string,
  profileId: string
): boolean => state.dirtyProfiles.has(profileKey(projectId, profileId))
export const emptyConfig = (outputDirectory: string): AppConfig => ({
  schemaVersion: APP_CONFIG_VERSION,
  groups: [],
  projects: [],
  retainedProjectConfigs: [],
  settings: {
    outputDirectory,
    showHiddenFiles: true,
    watcherEnabled: true,
    notificationsEnabled: true,
    taskConcurrency: 'auto',
    existingOutputBehavior: 'ask',
    globalHardExcludes: [],
    checkForUpdatesOnStartup: true
  }
})
