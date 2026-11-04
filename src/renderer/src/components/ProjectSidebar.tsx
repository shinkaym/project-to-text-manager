import { useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  Text
} from '@fluentui/react-components'
import {
  Add16Regular,
  ArrowDown16Regular,
  ArrowUp16Regular,
  Delete16Regular,
  Edit16Regular,
  FolderAdd16Regular
} from '@fluentui/react-icons'
import type { Group, PickedProject, Project } from '../../../shared/model'
import { useAppStore } from '../store/app-store'

export function ProjectSidebar(): React.JSX.Element {
  const config = useAppStore((state) => state.config)
  const openProject = useAppStore((state) => state.openProject)
  const mutateConfig = useAppStore((state) => state.mutateConfig)
  const addPickedProject = useAppStore((state) => state.addPickedProject)
  const availability = useAppStore((state) => state.availability)
  const [groupName, setGroupName] = useState('')
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [editName, setEditName] = useState('')
  const [picked, setPicked] = useState<PickedProject | null>(null)
  const [framework, setFramework] = useState('')
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState(false)

  const groups = useMemo(
    () => [...(config?.groups ?? [])].sort((a, b) => a.order - b.order),
    [config?.groups]
  )
  const projectsFor = (id: string | null): Project[] =>
    [...(config?.projects.filter((project) => project.groupId === id) ?? [])].sort(
      (a, b) => a.order - b.order
    )

  if (!config) return <aside className="project-sidebar" />

  const pickProject = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.desktop.projects.pick()
      if (!result) return
      setPicked(result)
      setFramework(result.detections.length === 1 ? result.detections[0]!.id : '')
      setGroupId('')
    } catch (error) {
      useAppStore.getState().setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const confirmAdd = async (): Promise<void> => {
    if (!picked) return
    setBusy(true)
    try {
      await addPickedProject(picked, framework as Project['framework'], groupId || null)
      setPicked(null)
    } catch (error) {
      useAppStore.getState().setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const createGroup = async (): Promise<void> => {
    const name = groupName.trim()
    if (!name) return
    await mutateConfig((draft) =>
      draft.groups.push({ id: crypto.randomUUID(), name, order: draft.groups.length })
    )
    setGroupName('')
  }
  const deleteGroup = async (id: string): Promise<void> => {
    await mutateConfig((draft) => {
      draft.groups = draft.groups.filter((group) => group.id !== id)
      for (const project of draft.projects.filter((item) => item.groupId === id))
        project.groupId = null
      draft.groups
        .sort((a, b) => a.order - b.order)
        .forEach((group, index) => {
          group.order = index
        })
    })
  }
  const moveGroup = async (id: string, delta: number): Promise<void> => {
    await mutateConfig((draft) => {
      const ordered = [...draft.groups].sort((a, b) => a.order - b.order)
      const index = ordered.findIndex((group) => group.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= ordered.length) return
      ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]
      ordered.forEach((group, order) => {
        group.order = order
      })
    })
  }
  const dropProject = async (
    projectId: string,
    targetGroup: string | null,
    beforeProjectId?: string
  ): Promise<void> => {
    await mutateConfig((draft) => {
      const moving = draft.projects.find((project) => project.id === projectId)
      if (!moving) return
      moving.groupId = targetGroup
      const siblings = draft.projects
        .filter((project) => project.groupId === targetGroup && project.id !== projectId)
        .sort((a, b) => a.order - b.order)
      const before = beforeProjectId
        ? siblings.findIndex((project) => project.id === beforeProjectId)
        : -1
      siblings.splice(before < 0 ? siblings.length : before, 0, moving)
      siblings.forEach((project, index) => {
        project.order = index
      })
    })
  }

  return (
    <aside className="project-sidebar">
      <div className="sidebar-title">
        <Text weight="semibold">PROJECTS</Text>
        <Button
          appearance="subtle"
          icon={<FolderAdd16Regular />}
          disabled={busy}
          onClick={() => void pickProject()}
          aria-label="Add Project"
        />
      </div>
      <div className="group-create">
        <Input
          value={groupName}
          onChange={(_, data) => setGroupName(data.value)}
          placeholder="New group"
        />
        <Button
          icon={<Add16Regular />}
          onClick={() => void createGroup()}
          aria-label="Create group"
        />
      </div>
      <div className="project-groups">
        {groups.map((group, index) => (
          <ProjectGroup
            key={group.id}
            group={group}
            projects={projectsFor(group.id)}
            availability={availability}
            canUp={index > 0}
            canDown={index < groups.length - 1}
            onOpen={(id) => void openProject(id)}
            onDrop={(projectId, before) => void dropProject(projectId, group.id, before)}
            groups={groups}
            onMoveToGroup={(projectId, targetGroup) => void dropProject(projectId, targetGroup)}
            onEdit={() => {
              setEditingGroup(group)
              setEditName(group.name)
            }}
            onDelete={() => void deleteGroup(group.id)}
            onMove={(delta) => void moveGroup(group.id, delta)}
          />
        ))}
        <ProjectGroup
          group={null}
          projects={projectsFor(null)}
          availability={availability}
          groups={groups}
          onOpen={(id) => void openProject(id)}
          onDrop={(projectId, before) => void dropProject(projectId, null, before)}
          onMoveToGroup={(projectId, targetGroup) => void dropProject(projectId, targetGroup)}
        />
      </div>

      <Dialog
        open={!!picked}
        onOpenChange={(_, data) => {
          if (!data.open) setPicked(null)
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Add Project</DialogTitle>
            <DialogContent className="dialog-fields">
              <Text>{picked?.folderName}</Text>
              {picked?.detections.length === 1 ? (
                <Field label="Detected framework">
                  <Text>
                    {picked.detections[0]!.name} — {picked.detections[0]!.evidence.join(', ')}
                  </Text>
                </Field>
              ) : (
                <Field label="Primary framework" required>
                  <Select value={framework} onChange={(_, data) => setFramework(data.value)}>
                    <option value="">Choose a primary framework…</option>
                    {picked?.detections.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {item.evidence.join(', ')}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Group">
                <Select value={groupId} onChange={(_, data) => setGroupId(data.value)}>
                  <option value="">Ungrouped</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                disabled={busy || !framework}
                onClick={() => void confirmAdd()}
              >
                Add Project
              </Button>
              <Button onClick={() => setPicked(null)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!editingGroup}
        onOpenChange={(_, data) => {
          if (!data.open) setEditingGroup(null)
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Rename Group</DialogTitle>
            <DialogContent>
              <Input value={editName} onChange={(_, data) => setEditName(data.value)} />
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={async () => {
                  const id = editingGroup?.id
                  const name = editName.trim()
                  if (id && name)
                    await mutateConfig((draft) => {
                      const group = draft.groups.find((item) => item.id === id)
                      if (group) group.name = name
                    })
                  setEditingGroup(null)
                }}
              >
                Rename
              </Button>
              <Button onClick={() => setEditingGroup(null)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </aside>
  )
}

type GroupProps = {
  group: Group | null
  projects: Project[]
  availability: Record<string, boolean>
  groups: Group[]
  canUp?: boolean
  canDown?: boolean
  onOpen: (id: string) => void
  onDrop: (projectId: string, beforeProjectId?: string) => void
  onMoveToGroup: (projectId: string, groupId: string | null) => void
  onEdit?: () => void
  onDelete?: () => void
  onMove?: (delta: number) => void
}

function ProjectGroup(props: GroupProps): React.JSX.Element {
  return (
    <section
      className="project-group"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const id = event.dataTransfer.getData('text/project-id')
        if (id) props.onDrop(id)
      }}
    >
      <div className="group-heading">
        <span>{props.group?.name ?? 'Ungrouped'}</span>
        {props.group && (
          <span className="group-actions">
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowUp16Regular />}
              disabled={!props.canUp}
              onClick={props.canUp ? () => props.onMove?.(-1) : undefined}
              aria-label="Move group up"
            />
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowDown16Regular />}
              disabled={!props.canDown}
              onClick={props.canDown ? () => props.onMove?.(1) : undefined}
              aria-label="Move group down"
            />
            <Button
              appearance="subtle"
              size="small"
              icon={<Edit16Regular />}
              onClick={props.onEdit}
              aria-label="Rename group"
            />
            <Button
              appearance="subtle"
              size="small"
              icon={<Delete16Regular />}
              onClick={props.onDelete}
              aria-label="Delete group"
            />
          </span>
        )}
      </div>
      {props.projects.map((project) => (
        <Menu key={project.id} openOnContext>
          <MenuTrigger disableButtonEnhancement>
            <button
              className="project-item"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/project-id', project.id)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation()
                event.preventDefault()
                const id = event.dataTransfer.getData('text/project-id')
                if (id) props.onDrop(id, project.id)
              }}
              onClick={() => props.onOpen(project.id)}
            >
              <span
                className={`availability-dot ${props.availability[project.id] === false ? 'offline' : ''}`}
              />
              <span>{project.displayName}</span>
              {props.availability[project.id] === false && <small>Unavailable</small>}
            </button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                disabled={project.groupId === null}
                onClick={() => props.onMoveToGroup(project.id, null)}
              >
                Move to Ungrouped
              </MenuItem>
              {props.groups.map((group) => (
                <MenuItem
                  key={group.id}
                  disabled={project.groupId === group.id}
                  onClick={() => props.onMoveToGroup(project.id, group.id)}
                >
                  Move to {group.name}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
      ))}
      {props.projects.length === 0 && <div className="empty-group">No projects</div>}
    </section>
  )
}
