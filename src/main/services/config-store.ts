import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AppConfig,
  ConfigLoadResult,
  Project,
  SessionState,
  Settings
} from '../../shared/model'
import {
  APP_CONFIG_VERSION,
  SESSION_VERSION,
  appConfigSchema,
  defaultSession,
  sessionSchema
} from '../../shared/model'

function assertAbsoluteWindowsPath(value: string, label: string): void {
  if (value.includes('\0') || !path.win32.isAbsolute(value))
    throw new Error(`${label} must be an absolute Windows path.`)
}

function assertSafeRelativeRule(value: string, label: string): void {
  const portable = value.replaceAll('\\', '/')
  if (value.includes('\0') || path.win32.isAbsolute(value) || portable.split('/').includes('..')) {
    throw new Error(`${label} must stay relative and cannot contain parent traversal.`)
  }
}

function validateProjectPaths(project: Project): void {
  assertAbsoluteWindowsPath(project.path, `Project path for ${project.displayName}`)
  assertAbsoluteWindowsPath(project.canonicalPath, `Canonical path for ${project.displayName}`)
  for (const rule of project.hardExcludes)
    assertSafeRelativeRule(rule, `Hard exclude for ${project.displayName}`)
  for (const profile of project.profiles) {
    for (const rule of profile.selection.manualIncludes)
      assertSafeRelativeRule(rule, `Included path for ${project.displayName}`)
    for (const rule of profile.selection.manualExcludes)
      assertSafeRelativeRule(rule, `Excluded path for ${project.displayName}`)
  }
}

function validateImportedPaths(config: AppConfig): void {
  assertAbsoluteWindowsPath(config.settings.outputDirectory, 'Global output directory')
  for (const rule of config.settings.globalHardExcludes)
    assertSafeRelativeRule(rule, 'Global hard exclude')
  for (const project of [...config.projects, ...config.retainedProjectConfigs])
    validateProjectPaths(project)
}

export class ConfigStore {
  private config: AppConfig | null = null
  private recoveryRequired = false

  constructor(
    private readonly configPath: string,
    private readonly sessionPath: string,
    private readonly defaultOutputDirectory: string
  ) {}

  private defaultSettings(): Settings {
    return {
      outputDirectory: this.defaultOutputDirectory,
      showHiddenFiles: true,
      watcherEnabled: true,
      notificationsEnabled: true,
      taskConcurrency: 'auto',
      globalHardExcludes: [],
      checkForUpdatesOnStartup: true
    }
  }

  private defaults(): AppConfig {
    return {
      schemaVersion: APP_CONFIG_VERSION,
      groups: [],
      projects: [],
      retainedProjectConfigs: [],
      settings: this.defaultSettings()
    }
  }

  async load(): Promise<ConfigLoadResult> {
    if (this.config) {
      return {
        config: structuredClone(this.config),
        recoveryRequired: this.recoveryRequired || undefined,
        recoveryMessage: this.recoveryRequired
          ? 'Local configuration is invalid. Reset local data or import a valid configuration to continue.'
          : undefined
      }
    }
    await mkdir(path.dirname(this.configPath), { recursive: true })
    try {
      const parsed = appConfigSchema.parse(JSON.parse(await readFile(this.configPath, 'utf8')))
      this.config = parsed
      return { config: structuredClone(parsed) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.config = this.defaults()
        this.recoveryRequired = true
        return {
          config: structuredClone(this.config),
          recoveryRequired: true,
          recoveryMessage:
            'Local configuration is invalid. The original file was preserved. Reset local data or import a valid configuration to continue.'
        }
      }
      this.config = this.defaults()
      await this.persist(this.config)
      return { config: structuredClone(this.config) }
    }
  }

  async save(value: AppConfig): Promise<AppConfig> {
    if (this.recoveryRequired)
      throw new Error('Resolve configuration recovery before saving changes.')
    const validated = appConfigSchema.parse(value)
    return this.persist(validated)
  }

  async update(mutator: (config: AppConfig) => AppConfig | void): Promise<AppConfig> {
    const current = (await this.load()).config
    const result = mutator(current) ?? current
    return this.save(result)
  }

  async replaceImported(raw: unknown): Promise<AppConfig> {
    const validated = appConfigSchema.parse(raw)
    validateImportedPaths(validated)
    this.recoveryRequired = false
    return this.persist(validated)
  }

  async resetLocalData(): Promise<AppConfig> {
    this.recoveryRequired = false
    const reset = await this.persist(this.defaults())
    await this.saveSession(defaultSession())
    return reset
  }

  async resetSettings(): Promise<AppConfig> {
    const current = (await this.load()).config
    return this.save({ ...current, settings: this.defaultSettings() })
  }

  async loadSession(): Promise<SessionState> {
    try {
      return sessionSchema.parse(JSON.parse(await readFile(this.sessionPath, 'utf8')))
    } catch {
      return defaultSession()
    }
  }

  async saveSession(value: SessionState): Promise<SessionState> {
    const validated = sessionSchema.parse({ ...value, schemaVersion: SESSION_VERSION })
    await this.atomicWrite(this.sessionPath, validated)
    return validated
  }

  private async persist(value: AppConfig): Promise<AppConfig> {
    const validated = appConfigSchema.parse(value)
    await this.atomicWrite(this.configPath, validated)
    this.config = validated
    return structuredClone(validated)
  }

  private async atomicWrite(target: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true })
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temp, target)
  }
}
