import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Select,
  Spinner,
  Text
} from '@fluentui/react-components'
import { outputExtension } from '../../../shared/output'
import type { Project } from '../../../shared/model'
import type { BatchPrepareStatus, BatchRowState } from '../store/batch-conversion'
import { orderedProjects } from '../store/batch-conversion'
import { useAppStore } from '../store/app-store'

const statusColor = (
  status: BatchPrepareStatus
): 'informative' | 'brand' | 'success' | 'warning' | 'danger' => {
  if (status === 'preparing' || status === 'queued') return 'brand'
  if (status === 'ready') return 'success'
  if (status === 'warning' || status === 'conflict') return 'warning'
  if (status === 'error') return 'danger'
  return 'informative'
}

const statusLabel = (row: BatchRowState): string => {
  const count = row.prepared?.request.selectedFiles.length
  const prefix = count === undefined ? '' : `${count.toLocaleString()} files · `
  if (row.status === 'idle') return 'Not prepared'
  if (row.status === 'preparing') return 'Preparing'
  if (row.status === 'ready') return `${prefix}Ready`
  if (row.status === 'warning') return `${prefix}Warning`
  if (row.status === 'conflict') return `${prefix}Output exists`
  if (row.status === 'queued') return `${prefix}Queued`
  return row.error ?? 'Error'
}

export function BatchConvertView(): React.JSX.Element {
  const config = useAppStore((state) => state.config)
  const availability = useAppStore((state) => state.availability)
  const rows = useAppStore((state) => state.batchRows)
  const banner = useAppStore((state) => state.batchBanner)
  const queueing = useAppStore((state) => state.batchQueueing)
  const dirtyProfiles = useAppStore((state) => state.dirtyProfiles)
  const initializeRows = useAppStore((state) => state.initializeBatchRows)
  const setSelected = useAppStore((state) => state.setBatchSelected)
  const setSelectedMany = useAppStore((state) => state.setBatchSelectedMany)
  const setProfile = useAppStore((state) => state.setBatchProfile)
  const setFormat = useAppStore((state) => state.setBatchFormat)
  const setBasename = useAppStore((state) => state.setBatchBasename)
  const prepareBatch = useAppStore((state) => state.prepareBatch)
  const queueBatch = useAppStore((state) => state.queueBatch)
  const dismissBanner = useAppStore((state) => state.dismissBatchBanner)
  const setActivity = useAppStore((state) => state.setActivity)
  const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null)
  const [collisionCount, setCollisionCount] = useState(0)

  useEffect(() => initializeRows(), [initializeRows, config, availability])

  const groups = useMemo(
    () => [...(config?.groups ?? [])].sort((a, b) => a.order - b.order),
    [config?.groups]
  )
  const projects = useMemo(() => (config ? orderedProjects(config) : []), [config])
  const availableIds = projects
    .filter((project) => availability[project.id] !== false)
    .map((project) => project.id)
  const selectedRows = availableIds
    .map((projectId) => rows[projectId])
    .filter((row): row is BatchRowState => row?.selected === true)
  const preparing = selectedRows.some((row) => row.status === 'preparing')
  const eligibleRows = selectedRows.filter(
    (row) => row.prepared && ['ready', 'warning', 'conflict'].includes(row.status)
  )
  const readyCount = selectedRows.filter((row) => row.status === 'ready').length
  const warningCount = selectedRows.filter((row) =>
    ['warning', 'conflict'].includes(row.status)
  ).length
  const detailsRow = detailsProjectId ? rows[detailsProjectId] : undefined
  const projectsFor = (groupId: string | null): Project[] =>
    projects.filter((project) => project.groupId === groupId)

  if (!config) return <main className="batch-view" />

  const requestQueue = async (behavior?: 'overwrite' | 'unique'): Promise<void> => {
    const result = await queueBatch(behavior)
    if (result.requiresCollisionChoice > 0) setCollisionCount(result.requiresCollisionChoice)
    else setCollisionCount(0)
  }

  return (
    <main className="batch-view">
      <div className="view-header batch-header">
        <div>
          <h1>Batch Convert</h1>
          <Text>Select projects, prepare snapshots, then queue every valid conversion.</Text>
        </div>
        <div className="button-row batch-actions">
          <Button
            disabled={availableIds.length === 0 || preparing || queueing}
          onClick={() =>
            setSelectedMany(availableIds, selectedRows.length !== availableIds.length)
          }
          >
            {selectedRows.length === availableIds.length && availableIds.length > 0
              ? 'Clear all'
              : 'Select all'}
          </Button>
          <Button
            disabled={selectedRows.length === 0 || preparing || queueing}
            onClick={() => void prepareBatch()}
          >
            {preparing ? <Spinner size="tiny" /> : 'Prepare selected'}
          </Button>
          <Button
            appearance="primary"
            disabled={eligibleRows.length === 0 || preparing || queueing}
            onClick={() => void requestQueue()}
          >
            {queueing ? <Spinner size="tiny" /> : 'Convert selected'}
          </Button>
        </div>
      </div>

      {banner && (
        <div className={`batch-banner ${banner.failed > 0 ? 'warning' : ''}`} role="status">
          <span>{banner.message}</span>
          <div className="button-row">
            <Button size="small" appearance="subtle" onClick={() => setActivity('tasks')}>
              View Tasks
            </Button>
            <Button size="small" appearance="subtle" onClick={dismissBanner}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="batch-summary" aria-live="polite">
        <span>
          <strong>{selectedRows.length}</strong> selected
        </span>
        <span>
          <strong>{readyCount}</strong> ready
        </span>
        <span>
          <strong>{warningCount}</strong> warnings
        </span>
        <span>
          Existing files:{' '}
          <strong>
            {config.settings.existingOutputBehavior === 'ask'
              ? 'Ask every time'
              : config.settings.existingOutputBehavior === 'overwrite'
                ? 'Overwrite'
                : 'Use unique filename'}
          </strong>
        </span>
      </div>

      <div className="batch-table-wrap">
        <table className="batch-table">
          <thead>
            <tr>
              <th aria-label="Select project" />
              <th>Project</th>
              <th>Profile</th>
              <th>Format</th>
              <th>Output</th>
              <th>Files / status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <BatchGroupRows
                key={group.id}
                name={group.name}
                projectIds={projectsFor(group.id).map((project) => project.id)}
                rows={rows}
                availability={availability}
                config={config}
                dirtyProfiles={dirtyProfiles}
                onSelected={setSelected}
                onSelectedMany={setSelectedMany}
                onProfile={setProfile}
                onFormat={setFormat}
                onBasename={setBasename}
                onDetails={setDetailsProjectId}
              />
            ))}
            <BatchGroupRows
              name="Ungrouped"
              projectIds={projectsFor(null).map((project) => project.id)}
              rows={rows}
              availability={availability}
              config={config}
              dirtyProfiles={dirtyProfiles}
              onSelected={setSelected}
              onSelectedMany={setSelectedMany}
              onProfile={setProfile}
              onFormat={setFormat}
              onBasename={setBasename}
              onDetails={setDetailsProjectId}
            />
          </tbody>
        </table>
      </div>

      {projects.length === 0 && (
        <div className="center-state batch-empty">Add a project before using Batch Convert.</div>
      )}

      <Dialog
        open={collisionCount > 0}
        onOpenChange={(_, data) => !data.open && setCollisionCount(0)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Existing output files</DialogTitle>
            <DialogContent>
              {collisionCount} selected conversion{collisionCount === 1 ? '' : 's'} already have an
              output file. Choose one behavior for this batch.
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => void requestQueue('overwrite')}>
                Overwrite all
              </Button>
              <Button onClick={() => void requestQueue('unique')}>Use unique filenames</Button>
              <Button onClick={() => setCollisionCount(0)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={!!detailsRow}
        onOpenChange={(_, data) => !data.open && setDetailsProjectId(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Preflight details</DialogTitle>
            <DialogContent>
              <ul className="issue-list">
                {detailsRow?.error && <li className="error">{detailsRow.error}</li>}
                {detailsRow?.prepared?.scanWarnings.map((warning, index) => (
                  <li key={`scan-${index}`} className="warning">
                    {warning}
                  </li>
                ))}
                {detailsRow?.prepared?.preflight.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className={issue.severity}>
                    {issue.relativePath ? `${issue.relativePath}: ` : ''}
                    {issue.message}
                  </li>
                ))}
                {detailsRow?.prepared?.preflight.outputExists && (
                  <li className="warning">
                    Output exists: {detailsRow.prepared.preflight.outputPath}
                  </li>
                )}
              </ul>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetailsProjectId(null)}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </main>
  )
}

type GroupRowsProps = {
  name: string
  projectIds: string[]
  rows: Record<string, BatchRowState>
  availability: Record<string, boolean>
  config: NonNullable<ReturnType<typeof useAppStore.getState>['config']>
  dirtyProfiles: Set<string>
  onSelected: (projectId: string, selected: boolean) => void
  onSelectedMany: (projectIds: string[], selected: boolean) => void
  onProfile: (projectId: string, profileId: string) => void
  onFormat: (projectId: string, format: 'markdown' | 'txt') => void
  onBasename: (projectId: string, basename: string) => void
  onDetails: (projectId: string) => void
}

function BatchGroupRows(props: GroupRowsProps): React.JSX.Element {
  const availableIds = props.projectIds.filter(
    (projectId) => props.availability[projectId] !== false
  )
  const selectedCount = availableIds.filter((projectId) => props.rows[projectId]?.selected).length
  const checked =
    selectedCount === 0 ? false : selectedCount === availableIds.length ? true : ('mixed' as const)
  return (
    <>
      <tr className="batch-group-row">
        <th colSpan={6} scope="rowgroup">
          <Checkbox
            checked={checked}
            disabled={availableIds.length === 0}
            label={`${props.name} · ${props.projectIds.length} project${props.projectIds.length === 1 ? '' : 's'}`}
            onChange={(_, data) => props.onSelectedMany(availableIds, data.checked === true)}
          />
        </th>
      </tr>
      {props.projectIds.map((projectId) => {
        const project = props.config.projects.find((candidate) => candidate.id === projectId)
        const row = props.rows[projectId]
        if (!project || !row) return null
        const available = props.availability[projectId] !== false
        const isDirty = props.dirtyProfiles.has(`${projectId}:${row.profileId}`)
        const preparing = row.status === 'preparing'
        const hasDetails =
          !!row.error ||
          !!row.prepared?.preflight.outputExists ||
          (row.prepared?.scanWarnings.length ?? 0) > 0 ||
          (row.prepared?.preflight.issues.length ?? 0) > 0
        return (
          <tr key={projectId} className={!available ? 'batch-project-unavailable' : undefined}>
            <td>
              <Checkbox
                checked={row.selected}
                disabled={!available}
                aria-label={`Select ${project.displayName}`}
                onChange={(_, data) => props.onSelected(projectId, data.checked === true)}
              />
            </td>
            <td>
              <div className="batch-project-name">
                <strong>{project.displayName}</strong>
                <small>
                  {project.framework} · {available ? 'Available' : 'Unavailable'}
                  {isDirty ? ' · Unsaved selection' : ''}
                </small>
              </div>
            </td>
            <td>
              <Select
                value={row.profileId}
                disabled={!available || preparing}
                aria-label={`Profile for ${project.displayName}`}
                onChange={(_, data) => props.onProfile(projectId, data.value)}
              >
                {project.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            </td>
            <td>
              <Select
                value={row.format}
                disabled={!available || preparing}
                aria-label={`Format for ${project.displayName}`}
                  onChange={(_, data) => props.onFormat(projectId, data.value as 'markdown' | 'txt')}
              >
                <option value="markdown">Markdown</option>
                <option value="txt">TXT</option>
              </Select>
            </td>
            <td>
              <Input
                value={row.basename}
                contentAfter={outputExtension(row.format)}
                disabled={!available || preparing}
                aria-label={`Output filename for ${project.displayName}`}
                onChange={(_, data) => props.onBasename(projectId, data.value)}
              />
            </td>
            <td>
              <div className="batch-status-cell">
                {preparing ? <Spinner size="tiny" /> : <Badge color={statusColor(row.status)} />}
                <span title={row.error}>{statusLabel(row)}</span>
                {hasDetails && (
                  <Button
                    size="small"
                    appearance="subtle"
                    onClick={() => props.onDetails(projectId)}
                  >
                    Details
                  </Button>
                )}
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}
