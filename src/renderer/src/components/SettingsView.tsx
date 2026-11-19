import { useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  Text,
  Textarea
} from '@fluentui/react-components'
import {
  ArrowDownload20Regular,
  ArrowUpload20Regular,
  FolderOpen20Regular
} from '@fluentui/react-icons'
import type { ExistingOutputBehavior } from '../../../shared/model'
import { BUILT_IN_HARD_EXCLUDES } from '../../../shared/presets'
import { useAppStore } from '../store/app-store'

type MajorAction = 'download' | 'install' | null

export function SettingsView(): React.JSX.Element {
  const config = useAppStore((state) => state.config)
  const mutateConfig = useAppStore((state) => state.mutateConfig)
  const setConfig = useAppStore((state) => state.setConfig)
  const syncWatcher = useAppStore((state) => state.syncWatcher)
  const update = useAppStore((state) => state.update)
  const [importOpen, setImportOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [majorAction, setMajorAction] = useState<MajorAction>(null)
  if (!config) return <div />

  const chooseOutput = async (): Promise<void> => {
    const directory = await window.desktop.output.pickDirectory()
    if (directory)
      await mutateConfig((draft) => {
        draft.settings.outputDirectory = directory
      })
  }
  const importConfig = async (): Promise<void> => {
    const result = await window.desktop.config.importConfig()
    setImportOpen(false)
    if (!result) return
    const session = useAppStore.getState().session
    const projectIds = new Set(result.config.projects.map((project) => project.id))
    const openProjectIds = session.openProjectIds.filter((id) => projectIds.has(id))
    const nextSession = {
      ...session,
      openProjectIds,
      activeProjectId:
        session.activeProjectId && openProjectIds.includes(session.activeProjectId)
          ? session.activeProjectId
          : (openProjectIds[0] ?? null)
    }
    await window.desktop.session.save(nextSession)
    setConfig(result.config)
    useAppStore.setState({
      session: nextSession,
      dirtyProfiles: new Set(),
      draftSelections: {},
      scans: {},
      selectedPaths: {}
    })
    await syncWatcher()
    useAppStore
      .getState()
      .setMessage('Configuration imported. Existing application configuration was replaced.')
  }
  const resetSettings = async (): Promise<void> => {
    const reset = await window.desktop.config.resetSettings()
    setConfig(reset)
    setResetOpen(false)
    await syncWatcher()
    useAppStore
      .getState()
      .setMessage('Application settings were reset. Projects, groups, and profiles were preserved.')
  }
  const checkUpdate = async (): Promise<void> => {
    const result = await window.desktop.updater.check()
    if (result.state === 'available' && result.majorVersionWarning) setMajorAction('download')
  }
  const requestDownload = (): void => {
    if (update?.majorVersionWarning) setMajorAction('download')
    else void window.desktop.updater.download()
  }
  const requestInstall = (): void => {
    if (update?.majorVersionWarning) setMajorAction('install')
    else void window.desktop.updater.install()
  }

  return (
    <main className="settings-view">
      <div className="view-header">
        <h1>Settings</h1>
        <Text>Global application configuration</Text>
      </div>
      <section className="settings-card">
        <h2>Output</h2>
        <Field label="Global output directory">
          <div className="directory-field">
            <Input readOnly value={config.settings.outputDirectory} />
            <Button icon={<FolderOpen20Regular />} onClick={() => void chooseOutput()}>
              Choose…
            </Button>
          </div>
        </Field>
        <Field label="When an output file already exists">
          <Select
            value={config.settings.existingOutputBehavior}
            onChange={(_, data) =>
              void mutateConfig((draft) => {
                draft.settings.existingOutputBehavior = data.value as ExistingOutputBehavior
              })
            }
          >
            <option value="ask">Ask every time</option>
            <option value="overwrite">Overwrite</option>
            <option value="unique">Use unique filename</option>
          </Select>
        </Field>
      </section>
      <section className="settings-card">
        <h2>Filesystem & tasks</h2>
        <Checkbox
          checked={config.settings.watcherEnabled}
          label="Enable filesystem watcher"
          onChange={async (_, data) => {
            await mutateConfig((draft) => {
              draft.settings.watcherEnabled = data.checked === true
            })
            await syncWatcher()
          }}
        />
        <Checkbox
          checked={config.settings.notificationsEnabled}
          label="Show Windows task notifications"
          onChange={(_, data) =>
            void mutateConfig((draft) => {
              draft.settings.notificationsEnabled = data.checked === true
            })
          }
        />
        <Field label="Concurrent conversions">
          <Select
            value={String(config.settings.taskConcurrency)}
            onChange={(_, data) =>
              void mutateConfig((draft) => {
                draft.settings.taskConcurrency = data.value === 'auto' ? 'auto' : Number(data.value)
              })
            }
          >
            <option value="auto">Auto</option>
            {[1, 2, 4, 8].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </section>
      <section className="settings-card">
        <h2>Hard excludes</h2>
        <Text>Built-in rules cannot be removed: {BUILT_IN_HARD_EXCLUDES.join(', ')}</Text>
        <Field label="Additional global hard excludes">
          <Textarea
            resize="vertical"
            value={config.settings.globalHardExcludes.join('\n')}
            placeholder="One path or glob per line"
            onChange={(_, data) =>
              void mutateConfig((draft) => {
                draft.settings.globalHardExcludes = data.value
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean)
              })
            }
          />
        </Field>
      </section>
      <section className="settings-card">
        <h2>Configuration</h2>
        <Text>
          Export includes projects, groups, profiles, and global settings. Session tabs and layout
          are excluded.
        </Text>
        <div className="button-row">
          <Button
            icon={<ArrowUpload20Regular />}
            onClick={() => void window.desktop.config.exportConfig()}
          >
            Export configuration
          </Button>
          <Button icon={<ArrowDownload20Regular />} onClick={() => setImportOpen(true)}>
            Import and replace…
          </Button>
          <Button onClick={() => setResetOpen(true)}>Reset Settings</Button>
        </div>
      </section>
      <section className="settings-card">
        <h2>Updates</h2>
        <Checkbox
          checked={config.settings.checkForUpdatesOnStartup}
          label="Check GitHub Releases on startup"
          onChange={(_, data) =>
            void mutateConfig((draft) => {
              draft.settings.checkForUpdatesOnStartup = data.checked === true
            })
          }
        />
        <div className="button-row">
          <Button onClick={() => void checkUpdate()}>Check for updates</Button>
          {update?.state === 'available' && (
            <Button appearance="primary" onClick={requestDownload}>
              Download {update.version}
            </Button>
          )}
          {update?.state === 'downloaded' && (
            <Button appearance="primary" onClick={requestInstall}>
              Restart and install
            </Button>
          )}
          <Text>{update?.message ?? update?.state}</Text>
        </div>
      </section>

      <Dialog open={importOpen} onOpenChange={(_, data) => setImportOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Replace application configuration?</DialogTitle>
            <DialogContent>
              Import replaces all current projects, groups, profiles, and global settings. Runtime
              session layout is not imported.
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void importConfig()}>
                Choose file and replace
              </Button>
              <Button onClick={() => setImportOpen(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={resetOpen} onOpenChange={(_, data) => setResetOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Reset application settings?</DialogTitle>
            <DialogContent>
              This restores default settings while preserving projects, groups, profiles, and saved
              selections.
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void resetSettings()}>
                Reset Settings
              </Button>
              <Button onClick={() => setResetOpen(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={majorAction !== null}
        onOpenChange={(_, data) => {
          if (!data.open) setMajorAction(null)
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Major version update</DialogTitle>
            <DialogContent>
              This major update will permanently reset all local application configuration
              immediately before installation and restart. No automatic backup will be created.
              Export configuration manually first if needed.
            </DialogContent>
            <DialogActions>
              {majorAction === 'download' && (
                <Button
                  appearance="primary"
                  onClick={() => {
                    setMajorAction(null)
                    void window.desktop.updater.download()
                  }}
                >
                  Download major update
                </Button>
              )}
              {majorAction === 'install' && (
                <Button
                  appearance="primary"
                  onClick={() => {
                    setMajorAction(null)
                    void window.desktop.updater.install()
                  }}
                >
                  Reset configuration, restart, and install
                </Button>
              )}
              <Button
                onClick={() => {
                  setMajorAction(null)
                  void window.desktop.config.exportConfig()
                }}
              >
                Export configuration
              </Button>
              <Button onClick={() => setMajorAction(null)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </main>
  )
}
