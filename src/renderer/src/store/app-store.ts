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

type Activity = 'projects' | 'tasks' | 'settings'
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
  setActivity: (activity) => set({ activity }),
  setMessage: (message) => set({ message }),
  setConfig: (config) => set({ config }),
  async saveConfig(config) {
    set({ config: await window.desktop.config.save(config) })
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
      dirtyProfiles: new Set(state.dirtyProfiles).add(key)
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
        draftSelections: { ...state.draftSelections, [key]: structuredClone(profile.selection) }
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
  async addPickedProject(picked, framework, groupId) {
    const before = new Set(get().config?.projects.map((project) => project.id) ?? [])
    const config = await window.desktop.projects.add({ token: picked.token, framework, groupId })
    set({ config })
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
