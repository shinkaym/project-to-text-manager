import { contextBridge, ipcRenderer } from 'electron'
import type { AppEventMap, DesktopApi } from '../shared/model'
import { IPC, eventChannels } from '../shared/ipc-channels'

const api: DesktopApi = {
  config: {
    load: () => ipcRenderer.invoke(IPC.configLoad),
    save: (config) => ipcRenderer.invoke(IPC.configSave, config),
    importConfig: () => ipcRenderer.invoke(IPC.configImport),
    exportConfig: () => ipcRenderer.invoke(IPC.configExport),
    resetLocalData: () => ipcRenderer.invoke(IPC.configResetLocalData),
    resetSettings: () => ipcRenderer.invoke(IPC.configResetSettings)
  },
  projects: {
    pick: () => ipcRenderer.invoke(IPC.projectPick),
    add: (input) => ipcRenderer.invoke(IPC.projectAdd, input),
    pickRelink: (projectId) => ipcRenderer.invoke(IPC.projectPickRelink, projectId),
    relink: (input) => ipcRenderer.invoke(IPC.projectRelink, input),
    scan: (input) => ipcRenderer.invoke(IPC.projectScan, input),
    refreshAvailability: () => ipcRenderer.invoke(IPC.projectAvailability)
  },
  output: { pickDirectory: () => ipcRenderer.invoke(IPC.outputPick) },
  conversion: {
    preflight: (request) => ipcRenderer.invoke(IPC.conversionPreflight, request),
    enqueue: (request) => ipcRenderer.invoke(IPC.conversionEnqueue, request),
    cancel: (taskId) => ipcRenderer.invoke(IPC.conversionCancel, taskId),
    list: () => ipcRenderer.invoke(IPC.conversionList),
    clearFinished: () => ipcRenderer.invoke(IPC.conversionClear)
  },
  session: {
    load: () => ipcRenderer.invoke(IPC.sessionLoad),
    save: (session) => ipcRenderer.invoke(IPC.sessionSave, session)
  },
  watcher: { sync: (openProjectIds) => ipcRenderer.invoke(IPC.watcherSync, openProjectIds) },
  updater: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    install: () => ipcRenderer.invoke(IPC.updateInstall)
  },
  app: {
    confirmClose: (action) => ipcRenderer.invoke(IPC.appConfirmClose, action),
    version: () => ipcRenderer.invoke(IPC.appVersion)
  },
  on: <K extends keyof AppEventMap>(channel: K, listener: (payload: AppEventMap[K]) => void) => {
    if (!(eventChannels as readonly string[]).includes(channel))
      throw new Error('Event channel is not allowed')
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppEventMap[K]): void =>
      listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('desktop', Object.freeze(api))
