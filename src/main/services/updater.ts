import { app } from 'electron'
import type { UpdateState } from '../../shared/model'
import updaterPackage from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'

const { autoUpdater } = updaterPackage

export class UpdaterService {
  private state: UpdateState = { state: 'idle', currentVersion: app.getVersion() }

  constructor(private readonly changed: (state: UpdateState) => void) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => this.available(info))
    autoUpdater.on('update-not-available', () => this.set({ state: 'not-available' }))
    autoUpdater.on('download-progress', (progress) =>
      this.set({ state: 'downloading', percent: progress.percent })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ state: 'downloaded', version: info.version })
    )
    autoUpdater.on('error', (error) => this.set({ state: 'error', message: error.message }))
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged)
      return this.set({
        state: 'not-available',
        message: 'Update checks are available in packaged builds.'
      })
    await autoUpdater.checkForUpdates()
    return this.state
  }

  async download(): Promise<void> {
    await autoUpdater.downloadUpdate()
  }
  isMajorUpdate(): boolean {
    return this.state.majorVersionWarning === true
  }
  install(): void {
    autoUpdater.quitAndInstall(false, true)
  }

  private available(info: UpdateInfo): void {
    const currentMajor = Number(app.getVersion().split('.')[0] ?? 0)
    const nextMajor = Number(info.version.split('.')[0] ?? 0)
    this.set({
      state: 'available',
      version: info.version,
      majorVersionWarning: nextMajor > currentMajor
    })
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch, currentVersion: app.getVersion() }
    this.changed(structuredClone(this.state))
    return structuredClone(this.state)
  }
}
