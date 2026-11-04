import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  Spinner,
  Text,
  Textarea
} from '@fluentui/react-components'
import {
  Add16Regular,
  Delete16Regular,
  Dismiss16Regular,
  Save16Regular
} from '@fluentui/react-icons'
import type { FrameworkId, Group, PickedProject, PreflightResult } from '../../../shared/model'
import { defaultOutputBasename, outputExtension } from '../../../shared/output'
import { PRESETS } from '../../../shared/presets'
import { activeProfileDirty, useAppStore } from '../store/app-store'
import { FileTree } from './FileTree'

type Props = { projectId: string }

const EMPTY_GROUPS: Group[] = []
const EMPTY_SELECTED_PATHS = new Set<string>()

export function ProjectWorkspace({ projectId }: Props): React.JSX.Element {
  const project = useAppStore((state) =>
    state.config?.projects.find((candidate) => candidate.id === projectId)
  )
  const groups = useAppStore((state) => state.config?.groups ?? EMPTY_GROUPS)
  const scan = useAppStore((state) => state.scans[projectId])
  const selected = useAppStore((state) => state.selectedPaths[projectId] ?? EMPTY_SELECTED_PATHS)
  const dirty = useAppStore((state) =>
    project ? activeProfileDirty(state, projectId, project.activeProfileId) : false
  )
  const outputState = useAppStore((state) => state.output[projectId])
  const mutateConfig = useAppStore((state) => state.mutateConfig)
  const scanProject = useAppStore((state) => state.scanProject)
  const saveProfile = useAppStore((state) => state.saveProfile)
  const discardProfile = useAppStore((state) => state.discardProfile)
  const setActiveProfile = useAppStore((state) => state.setActiveProfile)
  const setOutputFormat = useAppStore((state) => state.setOutputFormat)
  const setOutputBasename = useAppStore((state) => state.setOutputBasename)
  const convert = useAppStore((state) => state.convert)
  const availability = useAppStore((state) => state.availability[projectId] ?? true)
  const layout = useAppStore((state) => state.session.layout)
  const setLayout = useAppStore((state) => state.setLayout)
  const [profileName, setProfileName] = useState('')
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [converting, setConverting] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [conflictTaskId, setConflictTaskId] = useState<string | null>(null)

  const profile = project?.profiles.find((candidate) => candidate.id === project.activeProfileId)
  const preset = project ? PRESETS[project.framework] : null
  const output =
    project && profile
      ? (outputState ?? {
          format: 'markdown' as const,
          basename:
            project.customOutputBasename ??
            defaultOutputBasename(project.displayName, profile.name),
          customized: !!project.customOutputBasename
        })
      : null
  const selectedSize = useMemo(
    () =>
      scan?.nodes
        .filter((node) => node.kind === 'file' && selected.has(node.relativePath))
        .reduce((total, node) => total + node.size, 0) ?? 0,
    [scan, selected]
  )

  if (!project || !profile || !preset || !output)
    return (
      <div className="center-state">
        <Text>Project configuration is unavailable.</Text>
      </div>
    )
  if (!availability) return <Unavailable projectId={projectId} name={project.displayName} />

  const requestProfileSwitch = (target: string): void => {
    if (target === project.activeProfileId) return
    if (dirty) setSwitchTarget(target)
    else void setActiveProfile(projectId, target)
  }
  const finishSwitch = async (choice: 'save' | 'discard' | 'cancel'): Promise<void> => {
    if (!switchTarget || choice === 'cancel') {
      setSwitchTarget(null)
      return
    }
    if (choice === 'save') await saveProfile(projectId, project.activeProfileId)
    else await discardProfile(projectId, project.activeProfileId)
    const target = switchTarget
    setSwitchTarget(null)
    await setActiveProfile(projectId, target)
  }
  const addProfile = async (): Promise<void> => {
    const name = profileName.trim()
    if (!name) return
    const id = crypto.randomUUID()
    await mutateConfig((config) => {
      const item = config.projects.find((candidate) => candidate.id === projectId)
      if (!item) return
      item.profiles.push({
        id,
        name,
        presetVersion: preset.version,
        selection: { manualIncludes: [], manualExcludes: [] }
      })
      item.activeProfileId = id
    })
    setProfileName('')
    await scanProject(projectId)
  }
  const deleteProfile = async (): Promise<void> => {
    if (project.profiles.length <= 1) return
    await mutateConfig((config) => {
      const item = config.projects.find((candidate) => candidate.id === projectId)!
      item.profiles = item.profiles.filter((candidate) => candidate.id !== profile.id)
      item.activeProfileId = item.profiles[0]!.id
    })
    await scanProject(projectId)
  }
  const runConversion = async (
    overwrite = false,
    allowUnique = false,
    bypassConflict = false
  ): Promise<void> => {
    setConverting(true)
    try {
      if (!bypassConflict) {
        const currentTasks = await window.desktop.conversion.list()
        useAppStore.setState({ tasks: currentTasks })
        const running = currentTasks.find(
          (task) => task.projectId === projectId && task.status === 'running'
        )
        if (running) {
          setConflictTaskId(running.id)
          return
        }
      }
      const result = await convert(projectId, overwrite, allowUnique)
      if ((overwrite || allowUnique) && result.valid) setPreflight(null)
      else setPreflight(result)
    } catch (error) {
      useAppStore.getState().setMessage((error as Error).message)
    } finally {
      setConverting(false)
    }
  }
  const removeProject = async (keep: boolean): Promise<void> => {
    await useAppStore.getState().closeProject(projectId)
    await mutateConfig((config) => {
      const index = config.projects.findIndex((candidate) => candidate.id === projectId)
      if (index < 0) return
      const removed = config.projects.splice(index, 1)[0]!
      if (keep) {
        removed.groupId = null
        removed.order = 0
        config.retainedProjectConfigs.push(removed)
      }
    })
    setRemoveOpen(false)
  }

  return (
    <div className="project-workspace">
      <div className="tree-pane" style={{ width: layout.treePaneWidth }}>
        <FileTree projectId={projectId} />
      </div>
      <div
        className="vertical-resizer"
        onPointerDown={(event) =>
          startPaneResize(
            event,
            layout.treePaneWidth,
            layout.configPaneWidth,
            (treePaneWidth, configPaneWidth) => void setLayout({ treePaneWidth, configPaneWidth })
          )
        }
      />
      <aside className="config-pane" style={{ width: layout.configPaneWidth }}>
        <div className="config-scroll">
            <header className="project-heading">
              <div>
                <h2>{project.displayName}</h2>
                <Text size={200}>{project.path}</Text>
                <div className="project-meta" aria-label="Project metadata">
                  <span>{preset.name}</span>
                  <span>Preset v{profile.presetVersion}</span>
                </div>
              </div>
              {dirty && (
                <Badge appearance="filled" color="brand">
                  Unsaved
                </Badge>
              )}
            </header>
            {profile.presetVersion < preset.version && (
              <div className="preset-update preset-update-compact">
                <Text>
                  Preset v{preset.version} is available. Applying it resets manual overrides.
                </Text>
                <Button
                  onClick={async () => {
                    await mutateConfig((config) => {
                      const item = config.projects
                        .find((candidate) => candidate.id === projectId)!
                        .profiles.find((candidate) => candidate.id === profile.id)!
                      item.presetVersion = preset.version
                      item.selection = { manualIncludes: [], manualExcludes: [] }
                    })
                    await scanProject(projectId)
                  }}
                >
                  Apply update
                </Button>
              </div>
            )}
            <section className="config-section output-section">
              <h3>Output</h3>
              <div className="selection-summary" aria-label="Selection summary">
                <span>
                  <strong>{selected.size.toLocaleString()}</strong> selected files
                </span>
                <span>
                  <strong>{formatBytes(selectedSize)}</strong>
                </span>
              </div>
              <Field label="Format">
                <Select
                  value={output.format}
                  onChange={(_, data) =>
                    setOutputFormat(projectId, data.value as 'markdown' | 'txt')
                  }
                >
                  <option value="markdown">Markdown (.md)</option>
                  <option value="txt">TXT (.txt)</option>
                </Select>
              </Field>
              <Field label="Filename">
                <div className="filename-field">
                  <Input
                    value={output.basename}
                    onChange={(_, data) => setOutputBasename(projectId, data.value)}
                  />
                  <span>{outputExtension(output.format)}</span>
                </div>
              </Field>
              <Button
                appearance="primary"
                size="large"
                disabled={selected.size === 0 || converting}
                onClick={() => void runConversion()}
              >
                {converting ? <Spinner size="tiny" /> : 'Convert'}
              </Button>
            </section>
            <details className="config-section advanced-settings profile-settings">
              <summary>
                <span>Profiles</span>
                <span className={`details-summary-value ${dirty ? 'dirty' : ''}`}>
                  {profile.name}
                  {dirty ? ' · Unsaved' : ''}
                </span>
              </summary>
              <div className="advanced-settings-body">
                <Field label="Active profile">
                  <Select value={profile.id} onChange={(_, data) => requestProfileSwitch(data.value)}>
                    {project.profiles.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="button-row">
                  <Button
                    icon={<Save16Regular />}
                    disabled={!dirty}
                    onClick={() => void saveProfile(projectId, profile.id)}
                  >
                    Save
                  </Button>
                  <Button
                    disabled={!dirty}
                    onClick={() => void discardProfile(projectId, profile.id)}
                  >
                    Discard
                  </Button>
                  <Button
                    icon={<Delete16Regular />}
                    disabled={project.profiles.length === 1}
                    onClick={() => void deleteProfile()}
                  >
                    Delete
                  </Button>
                </div>
                <div className="inline-form">
                  <Input
                    value={profileName}
                    onChange={(_, data) => setProfileName(data.value)}
                    placeholder="New profile name"
                  />
                  <Button icon={<Add16Regular />} onClick={() => void addProfile()}>
                    Add
                  </Button>
                </div>
              </div>
            </details>
            <details className="config-section project-settings advanced-settings">
              <summary>
                <span>Project settings</span>
                <span className="details-summary-value">Advanced</span>
              </summary>
              <div className="advanced-settings-body">
                <div className="summary-row">
                  <span>Framework</span>
                  <strong>{preset.name}</strong>
                </div>
                <div className="summary-row">
                  <span>Preset</span>
                  <strong>v{profile.presetVersion}</strong>
                </div>
                <Field label="Display name">
                  <Input
                    value={project.displayName}
                    onChange={(_, data) =>
                      void mutateConfig((config) => {
                        const item = config.projects.find((candidate) => candidate.id === projectId)
                        if (item && data.value.trim()) item.displayName = data.value
                      })
                    }
                  />
                </Field>
                <Field label="Group">
                  <Select
                    value={project.groupId ?? ''}
                    onChange={(_, data) =>
                      void mutateConfig((config) => {
                        const item = config.projects.find((candidate) => candidate.id === projectId)
                        if (item) item.groupId = data.value || null
                      })
                    }
                  >
                    <option value="">Ungrouped</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Additional hard excludes">
                  <Textarea
                    value={project.hardExcludes.join('\n')}
                    onChange={(_, data) =>
                      void mutateConfig((config) => {
                        const item = config.projects.find((candidate) => candidate.id === projectId)
                        if (item)
                          item.hardExcludes = data.value
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter(Boolean)
                      })
                    }
                    placeholder="One path or glob per line"
                  />
                </Field>
                <Button
                  appearance="secondary"
                  icon={<Dismiss16Regular />}
                  onClick={() => setRemoveOpen(true)}
                >
                  Remove project…
                </Button>
              </div>
            </details>
        </div>
      </aside>

      <Dialog open={!!conflictTaskId}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Conversion already running</DialogTitle>
            <DialogContent>
              This project already has a running conversion. Cancel it or queue a new snapshot.
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  const taskId = conflictTaskId
                  setConflictTaskId(null)
                  if (taskId)
                    void window.desktop.conversion
                      .cancel(taskId)
                      .then(() => runConversion(false, false, true))
                }}
              >
                Cancel Current
              </Button>
              <Button
                onClick={() => {
                  setConflictTaskId(null)
                  void runConversion(false, false, true)
                }}
              >
                Queue New
              </Button>
              <Button onClick={() => setConflictTaskId(null)}>Cancel Action</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={!!switchTarget}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Unsaved profile changes</DialogTitle>
            <DialogContent>
              Save changes to “{profile.name}” before switching profiles?
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void finishSwitch('save')}>
                Save
              </Button>
              <Button onClick={() => void finishSwitch('discard')}>Discard</Button>
              <Button onClick={() => void finishSwitch('cancel')}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!preflight && (preflight.outputExists || preflight.issues.length > 0)}
        onOpenChange={(_, data) => {
          if (!data.open) setPreflight(null)
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {preflight?.valid ? 'Preflight warnings' : 'Preflight failed'}
            </DialogTitle>
            <DialogContent>
              <ul className="issue-list">
                {preflight?.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className={issue.severity}>
                    {issue.relativePath ? `${issue.relativePath}: ` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
              {preflight?.outputExists && (
                <p>The output file already exists: {preflight.outputPath}</p>
              )}
            </DialogContent>
            <DialogActions className="preflight-actions">
              {preflight?.valid && preflight.outputExists && (
                <>
                  <Button
                    appearance="primary"
                    className="preflight-action"
                    onClick={() => {
                      setPreflight(null)
                      void runConversion(true)
                    }}
                  >
                    Overwrite
                  </Button>
                  <Button
                    className="preflight-action"
                    onClick={() => {
                      setPreflight(null)
                      void runConversion(false, true)
                    }}
                  >
                    Use unique filename
                  </Button>
                </>
              )}
              <Button className="preflight-action" onClick={() => setPreflight(null)}>
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={removeOpen} onOpenChange={(_, data) => setRemoveOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Remove {project.displayName}</DialogTitle>
            <DialogContent>
              Source files are never deleted. Choose whether to retain this project&apos;s profiles
              and settings for later re-adding.
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void removeProject(false)}>
                Remove Project & Delete Config
              </Button>
              <Button onClick={() => void removeProject(true)}>Remove Project & Keep Config</Button>
              <Button onClick={() => setRemoveOpen(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}

function Unavailable({ projectId, name }: { projectId: string; name: string }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<PickedProject | null>(null)
  const [framework, setFramework] = useState<FrameworkId | ''>('')

  const applyRelink = async (
    selection: PickedProject,
    selectedFramework: FrameworkId
  ): Promise<void> => {
    setBusy(true)
    try {
      useAppStore.getState().setConfig(
        await window.desktop.projects.relink({
          projectId,
          token: selection.token,
          framework: selectedFramework
        })
      )
      useAppStore.setState((state) => ({
        availability: { ...state.availability, [projectId]: true }
      }))
      setPicked(null)
      setFramework('')
      await useAppStore.getState().scanProject(projectId)
    } catch (error) {
      useAppStore.getState().setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const relink = async (): Promise<void> => {
    setBusy(true)
    try {
      const selection = await window.desktop.projects.pickRelink(projectId)
      if (!selection) return
      if (selection.detections.length === 1) {
        await applyRelink(selection, selection.detections[0]!.id)
      } else {
        setPicked(selection)
        setFramework('')
      }
    } catch (error) {
      useAppStore.getState().setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="center-state">
        <h2>{name}</h2>
        <Badge color="danger">Unavailable</Badge>
        <Text>
          The project folder is missing, moved, or inaccessible. Its configuration is preserved.
        </Text>
        <Button appearance="primary" disabled={busy} onClick={() => void relink()}>
          Relink…
        </Button>
      </div>
      <Dialog
        open={!!picked}
        onOpenChange={(_, data) => {
          if (!data.open && !busy) {
            setPicked(null)
            setFramework('')
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Choose framework</DialogTitle>
            <DialogContent>
              <Text>
                Multiple frameworks were detected in {picked?.folderName}. Choose the one this
                project should use.
              </Text>
              <Field label="Framework" required>
                <Select
                  value={framework}
                  onChange={(_, data) => setFramework(data.value as FrameworkId)}
                >
                  <option value="" disabled>
                    Select a framework
                  </option>
                  {picked?.detections.map((detection) => (
                    <option key={detection.id} value={detection.id}>
                      {detection.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                disabled={!picked || !framework || busy}
                onClick={() => {
                  if (picked && framework) void applyRelink(picked, framework)
                }}
              >
                Relink
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setPicked(null)
                  setFramework('')
                }}
              >
                Cancel
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  )
}
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 ** 2).toFixed(1)} MB`
}

function startPaneResize(
  event: React.PointerEvent,
  treeInitial: number,
  configInitial: number,
  onChange: (treeWidth: number, configWidth: number) => void
): void {
  const start = event.clientX
  const move = (moveEvent: PointerEvent): void => {
    const delta = moveEvent.clientX - start
    onChange(
      Math.min(1400, Math.max(260, treeInitial + delta)),
      Math.min(1000, Math.max(300, configInitial - delta))
    )
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
