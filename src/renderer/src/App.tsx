import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Text
} from '@fluentui/react-components'
import {
  Dismiss16Regular,
  DocumentMultiple20Regular,
  Folder20Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  Settings20Regular,
  TaskListSquareLtr20Regular
} from '@fluentui/react-icons'
import { PRESETS } from '../../shared/presets'
import { activeProfileDirty, useAppStore } from './store/app-store'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ProjectWorkspace } from './components/ProjectWorkspace'
import { BatchConvertView } from './components/BatchConvertView'
import { SettingsView } from './components/SettingsView'
import { TaskLog, TasksView } from './components/TasksView'

export default function App(): React.JSX.Element {
  const initialized = useAppStore((state) => state.initialized)
  const initialize = useAppStore((state) => state.initialize)
  const config = useAppStore((state) => state.config)
  const session = useAppStore((state) => state.session)
  const activity = useAppStore((state) => state.activity)
  const setActivity = useAppStore((state) => state.setActivity)
  const focusProject = useAppStore((state) => state.focusProject)
  const closeProject = useAppStore((state) => state.closeProject)
  const saveProfile = useAppStore((state) => state.saveProfile)
  const discardProfile = useAppStore((state) => state.discardProfile)
  const saveAllDirty = useAppStore((state) => state.saveAllDirty)
  const setLayout = useAppStore((state) => state.setLayout)
  const tasks = useAppStore((state) => state.tasks)
  const scans = useAppStore((state) => state.scans)
  const selectedPaths = useAppStore((state) => state.selectedPaths)
  const outputStates = useAppStore((state) => state.output)
  const batchRows = useAppStore((state) => state.batchRows)
  const message = useAppStore((state) => state.message)
  const setMessage = useAppStore((state) => state.setMessage)
  const recoveryRequired = useAppStore((state) => state.recoveryRequired)
  const recoveryMessage = useAppStore((state) => state.recoveryMessage)
  const [closingProject, setClosingProject] = useState<string | null>(null)
  const [appCloseOpen, setAppCloseOpen] = useState(false)

  useEffect(() => {
    void initialize()
  }, [initialize])
  useEffect(() => {
    const unsubscribers = [
      window.desktop.on('config:changed', (value) => useAppStore.getState().setConfig(value)),
      window.desktop.on('tasks:changed', (value) => useAppStore.setState({ tasks: value })),
      window.desktop.on('updater:changed', (value) => useAppStore.setState({ update: value })),
      window.desktop.on('watcher:changed', ({ projectId }) => {
        if (useAppStore.getState().session.openProjectIds.includes(projectId))
          void useAppStore.getState().scanProject(projectId, true)
      }),
      window.desktop.on('app:before-close', () => {
        const state = useAppStore.getState()
        const activeTasks = state.tasks.some(
          (task) => task.status === 'queued' || task.status === 'running'
        )
        if (state.dirtyProfiles.size > 0 || activeTasks) setAppCloseOpen(true)
        else void window.desktop.app.confirmClose('discard')
      })
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  const openProjects = useMemo(
    () =>
      session.openProjectIds
        .map((id) => config?.projects.find((project) => project.id === id))
        .filter((value) => !!value),
    [session.openProjectIds, config?.projects]
  )
  const activeProject = config?.projects.find((project) => project.id === session.activeProjectId)
  const activeProfile = activeProject?.profiles.find(
    (profile) => profile.id === activeProject.activeProfileId
  )
  const activeScan = activeProject ? scans[activeProject.id] : undefined
  const activeSelected = activeProject ? (selectedPaths[activeProject.id]?.size ?? 0) : 0
  const activeFormat = activeProject
    ? (outputStates[activeProject.id]?.format ?? 'markdown')
    : 'markdown'
  const activeTask =
    [...tasks].reverse().find((task) => task.projectId === activeProject?.id) ??
    [...tasks].reverse()[0]

  if (!initialized || !config)
    return (
      <div className="app-loading">
        <Spinner size="large" label="Loading Project-to-Text Manager…" />
      </div>
    )

  const requestCloseProject = (projectId: string): void => {
    const project = config.projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    if (activeProfileDirty(useAppStore.getState(), project.id, project.activeProfileId))
      setClosingProject(projectId)
    else void closeProject(projectId)
  }
  const finishTabClose = async (choice: 'save' | 'discard' | 'cancel'): Promise<void> => {
    if (!closingProject || choice === 'cancel') {
      setClosingProject(null)
      return
    }
    const project = config.projects.find((candidate) => candidate.id === closingProject)
    if (!project) return
    if (choice === 'save') await saveProfile(project.id, project.activeProfileId)
    else await discardProfile(project.id, project.activeProfileId)
    setClosingProject(null)
    await closeProject(project.id)
  }
  const finishAppClose = async (choice: 'save' | 'discard' | 'cancel'): Promise<void> => {
    if (choice === 'save') await saveAllDirty()
    setAppCloseOpen(false)
    await window.desktop.app.confirmClose(choice)
  }
  const finishRecovery = async (action: 'reset' | 'import'): Promise<void> => {
    const recovered =
      action === 'reset'
        ? await window.desktop.config.resetLocalData()
        : (await window.desktop.config.importConfig())?.config
    if (!recovered) return
    const loadedSession = await window.desktop.session.load()
    const projectIds = new Set(recovered.projects.map((project) => project.id))
    const openProjectIds = loadedSession.openProjectIds.filter((id) => projectIds.has(id))
    const sessionAfterRecovery = {
      ...loadedSession,
      openProjectIds,
      activeProjectId:
        loadedSession.activeProjectId && openProjectIds.includes(loadedSession.activeProjectId)
          ? loadedSession.activeProjectId
          : (openProjectIds[0] ?? null)
    }
    await window.desktop.session.save(sessionAfterRecovery)
    useAppStore.setState({
      config: recovered,
      session: sessionAfterRecovery,
      batchRows: {},
      batchBanner: null,
      recoveryRequired: false,
      recoveryMessage: null
    })
    useAppStore.setState({ availability: await window.desktop.projects.refreshAvailability() })
    await window.desktop.watcher.sync(openProjectIds)
  }

  return (
    <div className="app-shell">
      <div className="app-titlebar">
        <span>Project-to-Text Manager</span>
        <span className="title-context">
          {activity === 'batch' ? 'Batch Convert' : (activeProject?.displayName ?? '')}
        </span>
      </div>
      <div className="shell-body">
        <nav className="activity-rail" aria-label="Primary navigation">
          <span className="rail-action" data-tooltip="Projects">
            <Button
              appearance={activity === 'projects' ? 'primary' : 'subtle'}
              icon={<Folder20Regular />}
              onClick={() => setActivity('projects')}
              aria-label="Projects"
            />
          </span>
          <span className="rail-action" data-tooltip="Batch Convert">
            <Button
              appearance={activity === 'batch' ? 'primary' : 'subtle'}
              icon={<DocumentMultiple20Regular />}
              onClick={() => setActivity('batch')}
              aria-label="Batch Convert"
            />
          </span>
          <span className="rail-button-wrap rail-action" data-tooltip="Tasks / Logs">
            <Button
              appearance={activity === 'tasks' ? 'primary' : 'subtle'}
              icon={<TaskListSquareLtr20Regular />}
              onClick={() => setActivity('tasks')}
              aria-label="Tasks and Logs"
            />
            <span className="rail-count">
              {tasks.filter((task) => ['queued', 'running'].includes(task.status)).length || ''}
            </span>
          </span>
          <span className="rail-spacer" />
          <span className="rail-action" data-tooltip="Settings">
            <Button
              appearance={activity === 'settings' ? 'primary' : 'subtle'}
              icon={<Settings20Regular />}
              onClick={() => setActivity('settings')}
              aria-label="Settings"
            />
          </span>
        </nav>
        {activity === 'projects' && (
          <>
            <div
              className={`sidebar-shell ${session.layout.sidebarCollapsed ? 'collapsed' : ''}`}
              style={{ width: session.layout.sidebarCollapsed ? 0 : session.layout.sidebarWidth }}
            >
              {!session.layout.sidebarCollapsed && <ProjectSidebar />}
            </div>
            <Button
              appearance="subtle"
              className="sidebar-toggle"
              icon={
                session.layout.sidebarCollapsed ? (
                  <PanelLeftExpand20Regular />
                ) : (
                  <PanelLeftContract20Regular />
                )
              }
              onClick={() => void setLayout({ sidebarCollapsed: !session.layout.sidebarCollapsed })}
              aria-label="Toggle sidebar"
            />
            {!session.layout.sidebarCollapsed && (
              <div
                className="vertical-resizer sidebar-resizer"
                onPointerDown={(event) =>
                  startResize(
                    event,
                    session.layout.sidebarWidth,
                    (sidebarWidth) => void setLayout({ sidebarWidth })
                  )
                }
              />
            )}
          </>
        )}
        <div className="content-column">
          {activity === 'projects' && (
            <>
              <div className="project-tabs" role="tablist">
                {openProjects.map((project) => {
                  const dirty = activeProfileDirty(
                    useAppStore.getState(),
                    project.id,
                    project.activeProfileId
                  )
                  return (
                    <div
                      key={project.id}
                      className={`project-tab ${session.activeProjectId === project.id ? 'active' : ''}`}
                      role="tab"
                      aria-selected={session.activeProjectId === project.id}
                      onClick={() => void focusProject(project.id)}
                    >
                      <span>{project.displayName}</span>
                      {dirty && (
                        <span className="dirty-dot" title="Unsaved changes">
                          ●
                        </span>
                      )}
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<Dismiss16Regular />}
                        onClick={(event) => {
                          event.stopPropagation()
                          requestCloseProject(project.id)
                        }}
                        aria-label={`Close ${project.displayName}`}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="workspace-host">
                {activeProject ? (
                  <ProjectWorkspace projectId={activeProject.id} />
                ) : (
                  <div className="welcome-state">
                    <h1>Project-to-Text Manager</h1>
                    <Text>
                      Open a local project from the sidebar to select source context and convert it
                      into one Markdown or TXT file.
                    </Text>
                  </div>
                )}
              </div>
              <div
                className={`log-panel ${session.layout.logPanelCollapsed ? 'collapsed' : ''}`}
                style={{
                  height: session.layout.logPanelCollapsed ? 28 : session.layout.logPanelHeight
                }}
              >
                <button
                  className="log-panel-title"
                  onClick={() =>
                    void setLayout({ logPanelCollapsed: !session.layout.logPanelCollapsed })
                  }
                >
                  <span>CONVERSION LOG</span>
                  <span>
                    {activeTask
                      ? `${activeTask.projectName} · ${activeTask.status}`
                      : 'No active task'}
                  </span>
                </button>
                {!session.layout.logPanelCollapsed && (
                  <>
                    <div
                      className="horizontal-resizer"
                      onPointerDown={(event) =>
                        startVerticalResize(
                          event,
                          session.layout.logPanelHeight,
                          (logPanelHeight) => void setLayout({ logPanelHeight })
                        )
                      }
                    />
                    <TaskLog task={activeTask} />
                  </>
                )}
              </div>
            </>
          )}
          {activity === 'batch' && <BatchConvertView />}
          {activity === 'tasks' && <TasksView />}
          {activity === 'settings' && <SettingsView />}
        </div>
      </div>
      <footer className="status-bar">
        {activity === 'batch' ? (
          <>
            <span>{Object.values(batchRows).filter((row) => row.selected).length} selected</span>
            <span>
              {
                    Object.values(batchRows).filter(
                      (row) => row.selected && ['ready', 'warning', 'conflict'].includes(row.status)
                    ).length
              }{' '}
              prepared
            </span>
          </>
        ) : (
          <>
            <span>{activeProject ? PRESETS[activeProject.framework].name : 'No project'}</span>
            <span>{activeProfile?.name ?? 'No profile'}</span>
            <span>{activeSelected.toLocaleString()} selected</span>
            <span>{activeFormat === 'markdown' ? 'Markdown' : 'TXT'}</span>
          </>
        )}
        <span>Watcher: {config.settings.watcherEnabled ? 'On' : 'Off'}</span>
        <span>{tasks.filter((task) => task.status === 'running').length} running</span>
        <span className="status-spacer" />
        <span>{activity === 'batch' ? 'batch' : (activeScan?.status ?? 'idle')}</span>
      </footer>

      <Dialog open={!!closingProject}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Unsaved project tab</DialogTitle>
            <DialogContent>Save the active profile before closing this project tab?</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void finishTabClose('save')}>
                Save
              </Button>
              <Button onClick={() => void finishTabClose('discard')}>Discard</Button>
              <Button onClick={() => void finishTabClose('cancel')}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={appCloseOpen}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Exit Project-to-Text Manager?</DialogTitle>
            <DialogContent>
              {tasks.length > 0
                ? 'Running and queued conversions will be cancelled and incomplete output will be cleaned. '
                : ''}
              {useAppStore.getState().dirtyProfiles.size > 0
                ? 'Choose whether to save unsaved profile selections.'
                : ''}
            </DialogContent>
            <DialogActions>
              {useAppStore.getState().dirtyProfiles.size > 0 && (
                <Button appearance="primary" onClick={() => void finishAppClose('save')}>
                  Save All & Exit
                </Button>
              )}
              <Button
                appearance={useAppStore.getState().dirtyProfiles.size > 0 ? 'secondary' : 'primary'}
                onClick={() => void finishAppClose('discard')}
              >
                {useAppStore.getState().dirtyProfiles.size > 0
                  ? 'Discard All & Exit'
                  : 'Exit & Cancel Tasks'}
              </Button>
              <Button onClick={() => void finishAppClose('cancel')}>Cancel Exit</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={recoveryRequired}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Configuration recovery required</DialogTitle>
            <DialogContent>
              {recoveryMessage ?? 'Local configuration is invalid.'} The application will not
              overwrite it until a recovery option is selected.
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void finishRecovery('reset')}>
                Reset Local Data
              </Button>
              <Button onClick={() => void finishRecovery('import')}>Import Config</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!message}
        onOpenChange={(_, data) => {
          if (!data.open) setMessage(null)
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Project-to-Text Manager</DialogTitle>
            <DialogContent>{message}</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setMessage(null)}>
                OK
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}

function startResize(
  event: React.PointerEvent,
  initial: number,
  update: (value: number) => void
): void {
  const start = event.clientX
  const move = (moveEvent: PointerEvent): void =>
    update(Math.min(600, Math.max(180, initial + moveEvent.clientX - start)))
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function startVerticalResize(
  event: React.PointerEvent,
  initial: number,
  update: (value: number) => void
): void {
  const start = event.clientY
  const move = (moveEvent: PointerEvent): void =>
    update(Math.min(800, Math.max(100, initial + start - moveEvent.clientY)))
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
