import { z } from 'zod'

export const APP_CONFIG_VERSION = 1 as const
export const SESSION_VERSION = 1 as const

export const frameworkIdSchema = z.enum([
  'react',
  'nextjs',
  'vue',
  'angular',
  'svelte',
  'electron',
  'node',
  'dotnet',
  'python',
  'java',
  'go',
  'rust',
  'generic'
])
export type FrameworkId = z.infer<typeof frameworkIdSchema>

export const selectionSchema = z.object({
  manualIncludes: z.array(z.string()).default([]),
  manualExcludes: z.array(z.string()).default([])
})
export type Selection = z.infer<typeof selectionSchema>

export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  presetVersion: z.number().int().positive(),
  selection: selectionSchema
})
export type Profile = z.infer<typeof profileSchema>

export const projectSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(120),
  path: z.string().min(1),
  canonicalPath: z.string().min(1),
  framework: frameworkIdSchema,
  groupId: z.string().nullable(),
  order: z.number().int().nonnegative(),
  profiles: z.array(profileSchema).min(1),
  activeProfileId: z.string().min(1),
  hardExcludes: z.array(z.string()).default([]),
  customOutputBasename: z.string().nullable().default(null)
})
export type Project = z.infer<typeof projectSchema>

export const groupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  order: z.number().int().nonnegative()
})
export type Group = z.infer<typeof groupSchema>

export const settingsSchema = z.object({
  outputDirectory: z.string().min(1),
  showHiddenFiles: z.boolean().default(true),
  watcherEnabled: z.boolean().default(true),
  notificationsEnabled: z.boolean().default(true),
  taskConcurrency: z.union([z.literal('auto'), z.number().int().min(1).max(8)]).default('auto'),
  globalHardExcludes: z.array(z.string()).default([]),
  checkForUpdatesOnStartup: z.boolean().default(true)
})
export type Settings = z.infer<typeof settingsSchema>

export const appConfigSchema = z
  .object({
    schemaVersion: z.literal(APP_CONFIG_VERSION),
    groups: z.array(groupSchema),
    projects: z.array(projectSchema),
    retainedProjectConfigs: z.array(projectSchema).default([]),
    settings: settingsSchema
  })
  .superRefine((config, context) => {
    const groupIds = new Set(config.groups.map((group) => group.id))
    const projectIds = new Set<string>()
    const canonicalPaths = new Set<string>()
    for (const project of config.projects) {
      if (projectIds.has(project.id))
        context.addIssue({ code: 'custom', message: `Duplicate project id: ${project.id}` })
      projectIds.add(project.id)
      const canonical = project.canonicalPath.toLocaleLowerCase('en-US')
      if (canonicalPaths.has(canonical))
        context.addIssue({ code: 'custom', message: `Duplicate project path: ${project.path}` })
      canonicalPaths.add(canonical)
      if (project.groupId && !groupIds.has(project.groupId))
        context.addIssue({ code: 'custom', message: `Unknown group: ${project.groupId}` })
      if (!project.profiles.some((profile) => profile.id === project.activeProfileId))
        context.addIssue({
          code: 'custom',
          message: `Active profile is missing for ${project.displayName}`
        })
    }
    for (const project of config.retainedProjectConfigs) {
      if (projectIds.has(project.id))
        context.addIssue({
          code: 'custom',
          message: `Duplicate retained project id: ${project.id}`
        })
      projectIds.add(project.id)
    }
  })
export type AppConfig = z.infer<typeof appConfigSchema>

export const layoutSchema = z.object({
  sidebarWidth: z.number().min(180).max(600).default(280),
  sidebarCollapsed: z.boolean().default(false),
  treePaneWidth: z.number().min(260).max(1400).default(620),
  treePaneCollapsed: z.boolean().default(false),
  configPaneWidth: z.number().min(300).max(1000).default(460),
  configPaneCollapsed: z.boolean().default(false),
  logPanelHeight: z.number().min(100).max(800).default(220),
  logPanelCollapsed: z.boolean().default(true)
})
export type LayoutState = z.infer<typeof layoutSchema>

export const sessionSchema = z.object({
  schemaVersion: z.literal(SESSION_VERSION),
  openProjectIds: z.array(z.string()),
  activeProjectId: z.string().nullable(),
  layout: layoutSchema
})
export type SessionState = z.infer<typeof sessionSchema>
export type ConfigLoadResult = {
  config: AppConfig
  recoveryRequired?: boolean
  recoveryMessage?: string
}
export type DetectedFramework = { id: FrameworkId; name: string; evidence: string[] }
export type PickedProject = { token: string; folderName: string; detections: DetectedFramework[] }

export type FileTreeNode = {
  id: string
  relativePath: string
  name: string
  parentPath: string | null
  kind: 'file' | 'directory'
  depth: number
  size: number
  mtimeMs: number
  hidden: boolean
  binary: boolean
  symlink: boolean
  selectable: boolean
  selectedByDefault: boolean
  exclusionReason?: 'preset' | 'gitignore' | 'binary'
}

export type ScanResult = {
  projectId: string
  nodes: FileTreeNode[]
  scannedAt: string
  warnings: string[]
}
export const outputFormatSchema = z.enum(['markdown', 'txt'])
export type OutputFormat = z.infer<typeof outputFormatSchema>
export const fileBaselineSchema = z.object({
  relativePath: z.string().min(1),
  size: z.number().nonnegative(),
  mtimeMs: z.number().nonnegative()
})
export type FileBaseline = z.infer<typeof fileBaselineSchema>

export const conversionRequestSchema = z.object({
  projectId: z.string().min(1),
  profileId: z.string().min(1),
  selectedFiles: z.array(fileBaselineSchema).min(1),
  format: outputFormatSchema,
  filename: z.string().trim().min(1).max(240),
  overwrite: z.boolean().default(false)
})
export type ConversionRequest = z.infer<typeof conversionRequestSchema>

export type PreflightIssue = {
  severity: 'error' | 'warning'
  code:
    | 'missing'
    | 'unreadable'
    | 'encoding'
    | 'binary'
    | 'outside-root'
    | 'duplicate'
    | 'changed'
    | 'large-file'
    | 'secret'
    | 'output'
    | 'empty'
  relativePath?: string
  message: string
}
export type PreflightResult = {
  valid: boolean
  issues: PreflightIssue[]
  outputPath: string
  outputExists: boolean
}
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskLog = { at: string; level: 'info' | 'warning' | 'error'; message: string }
export type ConversionTask = {
  id: string
  projectId: string
  projectName: string
  profileName: string
  status: TaskStatus
  progress: number
  currentFile?: string
  processedCount: number
  totalCount: number
  outputPath?: string
  error?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  logs: TaskLog[]
}

export type UpdateState = {
  state:
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  majorVersionWarning?: boolean
}

export type AppEventMap = {
  'config:changed': AppConfig
  'watcher:changed': { projectId: string; paths: string[] }
  'tasks:changed': ConversionTask[]
  'updater:changed': UpdateState
  'app:before-close': undefined
}
export type Unsubscribe = () => void

export interface DesktopApi {
  config: {
    load(): Promise<ConfigLoadResult>
    save(config: AppConfig): Promise<AppConfig>
    importConfig(): Promise<ConfigLoadResult | null>
    exportConfig(): Promise<string | null>
    resetLocalData(): Promise<AppConfig>
    resetSettings(): Promise<AppConfig>
  }
  projects: {
    pick(): Promise<PickedProject | null>
    add(input: {
      token: string
      framework: FrameworkId
      groupId: string | null
    }): Promise<AppConfig>
    pickRelink(projectId: string): Promise<PickedProject | null>
    relink(input: { projectId: string; token: string; framework: FrameworkId }): Promise<AppConfig>
    scan(input: { projectId: string; profileId: string }): Promise<ScanResult>
    refreshAvailability(): Promise<Record<string, boolean>>
  }
  output: { pickDirectory(): Promise<string | null> }
  conversion: {
    preflight(request: ConversionRequest): Promise<PreflightResult>
    enqueue(request: ConversionRequest): Promise<ConversionTask>
    cancel(taskId: string): Promise<void>
    list(): Promise<ConversionTask[]>
    clearFinished(): Promise<ConversionTask[]>
  }
  session: { load(): Promise<SessionState>; save(session: SessionState): Promise<SessionState> }
  watcher: { sync(openProjectIds: string[]): Promise<void> }
  updater: { check(): Promise<UpdateState>; download(): Promise<void>; install(): Promise<void> }
  app: {
    confirmClose(action: 'save' | 'discard' | 'cancel'): Promise<void>
    version(): Promise<string>
  }
  on<K extends keyof AppEventMap>(
    channel: K,
    listener: (payload: AppEventMap[K]) => void
  ): Unsubscribe
}

export const defaultLayout = (): LayoutState => ({
  sidebarWidth: 280,
  sidebarCollapsed: false,
  treePaneWidth: 620,
  treePaneCollapsed: false,
  configPaneWidth: 460,
  configPaneCollapsed: false,
  logPanelHeight: 220,
  logPanelCollapsed: true
})
export const defaultSession = (): SessionState => ({
  schemaVersion: SESSION_VERSION,
  openProjectIds: [],
  activeProjectId: null,
  layout: defaultLayout()
})
