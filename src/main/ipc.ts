import { randomUUID } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  IPC,
  appConfigSchema,
  closeActionSchema,
  conversionRequestSchema,
  projectAddSchema,
  projectIdSchema,
  projectRelinkSchema,
  projectScanSchema,
  sessionSchema,
  watcherSyncSchema
} from '../shared/ipc'
import type { AppConfig, DetectedFramework, PickedProject } from '../shared/model'
import { PRESETS } from '../shared/presets'
import type { ConfigStore } from './services/config-store'
import { detectFrameworks } from './services/framework-detector'
import { scanProject } from './services/file-scanner'
import { canonicalPath } from './services/path-security'
import type { PreflightService } from './services/preflight'
import type { ProjectWatcherService } from './services/watcher'
import type { TaskRuntime } from './services/task-runtime'
import type { UpdaterService } from './services/updater'

type PickToken = { path: string; detections: DetectedFramework[]; projectId?: string }

type Dependencies = {
  window: () => BrowserWindow | null
  store: ConfigStore
  preflight: PreflightService
  tasks: TaskRuntime
  watcher: ProjectWatcherService
  updater: UpdaterService
  confirmClose: (action: 'save' | 'discard' | 'cancel') => Promise<void>
}

export function registerIpc(deps: Dependencies): void {
  const pickTokens = new Map<string, PickToken>()
  let allowedOutputDirectory: string | null = null
  const assertSender = (event: IpcMainInvokeEvent): void => {
    const window = deps.window()
    if (!window || event.sender !== window.webContents) throw new Error('Untrusted IPC sender')
  }
  const handle = <T>(
    channel: string,
    schema: z.ZodType<T> | null,
    callback: (value: T, event: IpcMainInvokeEvent) => unknown | Promise<unknown>
  ): void => {
    ipcMain.handle(channel, async (event, raw) => {
      assertSender(event)
      const value = schema ? schema.parse(raw) : (undefined as T)
      return callback(value, event)
    })
  }
  const sendConfig = (config: AppConfig): void =>
    deps.window()?.webContents.send('config:changed', config)

  handle(IPC.configLoad, null, () => deps.store.load())
  handle(IPC.configSave, appConfigSchema, async (config) => {
    const current = (await deps.store.load()).config
    const existingProjects = new Map(
      [...current.projects, ...current.retainedProjectConfigs].map((project) => [
        project.id,
        project
      ])
    )
    for (const project of [...config.projects, ...config.retainedProjectConfigs]) {
      const existing = existingProjects.get(project.id)
      if (!existing) throw new Error('Project records can only be created through Add Project')
      project.path = existing.path
      project.canonicalPath = existing.canonicalPath
      project.framework = existing.framework
    }
    if (config.settings.outputDirectory !== current.settings.outputDirectory) {
      if (
        !allowedOutputDirectory ||
        path.resolve(config.settings.outputDirectory).toLocaleLowerCase('en-US') !==
          path.resolve(allowedOutputDirectory).toLocaleLowerCase('en-US')
      ) {
        throw new Error('Output directory must be chosen with the folder picker')
      }
    }
    allowedOutputDirectory = null
    const saved = await deps.store.save(config)
    sendConfig(saved)
    return saved
  })
  handle(IPC.configImport, null, async () => {
    const result = await dialog.showOpenDialog(deps.window()!, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    const filename = result.filePaths[0]
    if (result.canceled || !filename) return null
    const imported = await deps.store.replaceImported(JSON.parse(await readFile(filename, 'utf8')))
    sendConfig(imported)
    return { config: imported }
  })
  handle(IPC.configResetLocalData, null, async () => {
    const reset = await deps.store.resetLocalData()
    sendConfig(reset)
    return reset
  })
  handle(IPC.configResetSettings, null, async () => {
    const reset = await deps.store.resetSettings()
    sendConfig(reset)
    return reset
  })
  handle(IPC.configExport, null, async () => {
    const result = await dialog.showSaveDialog(deps.window()!, {
      defaultPath: 'project-to-text-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const config = (await deps.store.load()).config
    await writeFile(result.filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return result.filePath
  })

  const pickFolder = async (projectId?: string): Promise<PickedProject | null> => {
    const result = await dialog.showOpenDialog(deps.window()!, {
      properties: ['openDirectory'],
      title: projectId ? 'Relink Project' : 'Add Project'
    })
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    const detections = await detectFrameworks(folder)
    const token = randomUUID()
    pickTokens.set(token, { path: folder, detections, projectId })
    setTimeout(() => pickTokens.delete(token), 10 * 60 * 1000).unref()
    return { token, folderName: path.basename(folder), detections }
  }
  handle(IPC.projectPick, null, () => pickFolder())
  handle(IPC.projectPickRelink, projectIdSchema, (projectId) => pickFolder(projectId))
  handle(IPC.projectAdd, projectAddSchema, async (input) => {
    const picked = pickTokens.get(input.token)
    if (!picked || picked.projectId) throw new Error('Folder selection expired')
    if (!picked.detections.some((candidate) => candidate.id === input.framework))
      throw new Error('Framework was not detected for this folder')
    const canonical = await canonicalPath(picked.path)
    const saved = await deps.store.update((config) => {
      if (
        config.projects.some(
          (project) => project.canonicalPath.toLocaleLowerCase('en-US') === canonical
        )
      )
        throw new Error('This project is already added')
      if (input.groupId && !config.groups.some((group) => group.id === input.groupId))
        throw new Error('Group not found')
      const retainedIndex = config.retainedProjectConfigs.findIndex(
        (project) => project.canonicalPath.toLocaleLowerCase('en-US') === canonical
      )
      if (retainedIndex >= 0) {
        const retained = config.retainedProjectConfigs.splice(retainedIndex, 1)[0]!
        retained.path = picked.path
        retained.canonicalPath = canonical
        retained.groupId = input.groupId
        retained.order = config.projects.filter(
          (project) => project.groupId === input.groupId
        ).length
        retained.framework = input.framework
        config.projects.push(retained)
        return
      }
      const projectId = randomUUID()
      const profileId = randomUUID()
      config.projects.push({
        id: projectId,
        displayName: path.basename(picked.path),
        path: picked.path,
        canonicalPath: canonical,
        framework: input.framework,
        groupId: input.groupId,
        order: config.projects.filter((project) => project.groupId === input.groupId).length,
        profiles: [
          {
            id: profileId,
            name: 'Default',
            presetVersion: PRESETS[input.framework].version,
            selection: { manualIncludes: [], manualExcludes: [] }
          }
        ],
        activeProfileId: profileId,
        hardExcludes: [],
        customOutputBasename: null
      })
    })
    pickTokens.delete(input.token)
    sendConfig(saved)
    return saved
  })
  handle(IPC.projectRelink, projectRelinkSchema, async (input) => {
    const picked = pickTokens.get(input.token)
    if (!picked || picked.projectId !== input.projectId) throw new Error('Folder selection expired')
    if (!picked.detections.some((candidate) => candidate.id === input.framework))
      throw new Error('Framework was not detected for this folder')
    const canonical = await canonicalPath(picked.path)
    const saved = await deps.store.update((config) => {
      if (
        config.projects.some(
          (project) =>
            project.id !== input.projectId &&
            project.canonicalPath.toLocaleLowerCase('en-US') === canonical
        )
      )
        throw new Error('Another project already uses this folder')
      const project = config.projects.find((candidate) => candidate.id === input.projectId)
      if (!project) throw new Error('Project not found')
      project.path = picked.path
      project.canonicalPath = canonical
      if (project.framework !== input.framework) {
        project.framework = input.framework
        for (const profile of project.profiles) {
          profile.selection = { manualIncludes: [], manualExcludes: [] }
          profile.presetVersion = PRESETS[input.framework].version
        }
      }
    })
    pickTokens.delete(input.token)
    sendConfig(saved)
    return saved
  })
  handle(IPC.projectScan, projectScanSchema, async (input) => {
    let config = (await deps.store.load()).config
    let project = config.projects.find((candidate) => candidate.id === input.projectId)
    if (!project) throw new Error('Project not found')
    const detections = await detectFrameworks(project.path)
    if (detections.length === 1 && detections[0]!.id !== project.framework) {
      config = await deps.store.update((mutable) => {
        const current = mutable.projects.find((candidate) => candidate.id === input.projectId)!
        current.framework = detections[0]!.id
        for (const profile of current.profiles) {
          profile.selection = { manualIncludes: [], manualExcludes: [] }
          profile.presetVersion = PRESETS[current.framework].version
        }
      })
      sendConfig(config)
      project = config.projects.find((candidate) => candidate.id === input.projectId)!
    }
    return scanProject({
      project,
      profileId: input.profileId,
      globalHardExcludes: config.settings.globalHardExcludes
    })
  })
  handle(IPC.projectAvailability, null, async () => {
    const config = (await deps.store.load()).config
    return Object.fromEntries(
      await Promise.all(
        config.projects.map(async (project) => [
          project.id,
          await access(project.path).then(
            () => true,
            () => false
          )
        ])
      )
    )
  })

  handle(IPC.outputPick, null, async () => {
    const result = await dialog.showOpenDialog(deps.window()!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Global Output Directory'
    })
    const selected = result.canceled ? null : (result.filePaths[0] ?? null)
    allowedOutputDirectory = selected
    return selected
  })
  handle(IPC.conversionPreflight, conversionRequestSchema, async (request) =>
    deps.preflight.run((await deps.store.load()).config, request)
  )
  handle(IPC.conversionEnqueue, conversionRequestSchema, (request) => deps.tasks.enqueue(request))
  handle(IPC.conversionCancel, projectIdSchema, (taskId) => deps.tasks.cancel(taskId))
  handle(IPC.conversionList, null, () => deps.tasks.list())
  handle(IPC.conversionClear, null, () => deps.tasks.clearFinished())

  handle(IPC.sessionLoad, null, () => deps.store.loadSession())
  handle(IPC.sessionSave, sessionSchema, (session) => deps.store.saveSession(session))
  handle(IPC.watcherSync, watcherSyncSchema, async (projectIds) =>
    deps.watcher.sync((await deps.store.load()).config, projectIds)
  )
  handle(IPC.updateCheck, null, () => deps.updater.check())
  handle(IPC.updateDownload, null, () => deps.updater.download())
  handle(IPC.updateInstall, null, async () => {
    if (deps.updater.isMajorUpdate()) await deps.store.resetLocalData()
    deps.updater.install()
  })
  handle(IPC.appConfirmClose, closeActionSchema, (action) => deps.confirmClose(action))
  handle(IPC.appVersion, null, () => process.env.npm_package_version ?? '1.0.0')
}
