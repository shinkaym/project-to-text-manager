import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, Notification, session, shell } from 'electron'
import { registerIpc } from './ipc'
import { ConfigStore } from './services/config-store'
import { PreflightService } from './services/preflight'
import { TaskRuntime } from './services/task-runtime'
import { ProjectWatcherService } from './services/watcher'
import { UpdaterService } from './services/updater'

let mainWindow: BrowserWindow | null = null
let closeApproved = false
let closePromptOpen = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function emit(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

async function bootstrap(): Promise<void> {
  if (process.platform !== 'win32')
    throw new Error('Project-to-Text Manager supports Windows 10 x64 or newer only.')
  const dataDirectory = app.getPath('userData')
  const store = new ConfigStore(
    join(dataDirectory, 'config.json'),
    join(dataDirectory, 'session.json'),
    join(app.getPath('documents'), 'Project-to-Text')
  )
  const preflight = new PreflightService()
  const autoConcurrency = Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2)))
  const tasks = new TaskRuntime(
    store,
    preflight,
    {
      changed: (value) => emit('tasks:changed', value),
      notify: (title, body, windows) => {
        if (windows && Notification.isSupported()) new Notification({ title, body }).show()
      }
    },
    autoConcurrency
  )
  const watcher = new ProjectWatcherService((projectId, paths) =>
    emit('watcher:changed', { projectId, paths })
  )
  const updater = new UpdaterService((value) => emit('updater:changed', value))

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'Project-to-Text Manager',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.on('close', (event) => {
    if (closeApproved) return
    event.preventDefault()
    if (!closePromptOpen) {
      closePromptOpen = true
      emit('app:before-close')
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerIpc({
    window: () => mainWindow,
    store,
    preflight,
    tasks,
    watcher,
    updater,
    confirmClose: async (action) => {
      closePromptOpen = false
      if (action === 'cancel') return
      await tasks.cancelAllAndWait()
      await watcher.close()
      closeApproved = true
      mainWindow?.close()
    }
  })

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' }
        ]
      },
      { label: 'Help', submenu: [{ label: 'Project-to-Text Manager', enabled: false }] }
    ])
  )

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const development = !app.isPackaged
    const allowed =
      details.url.startsWith('file:') ||
      details.url.startsWith('devtools:') ||
      (development && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(details.url))
    callback({ cancel: !allowed })
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererUrl) await mainWindow.loadURL(rendererUrl)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  const loaded = await store.load()
  if (loaded.config.settings.checkForUpdatesOnStartup)
    setTimeout(() => {
      void updater.check()
    }, 3000).unref()
  app.on('before-quit', () => {
    void watcher.close()
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.projecttotext.manager')
  await bootstrap()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
app.on('window-all-closed', () => app.quit())
