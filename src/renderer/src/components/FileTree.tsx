import { useMemo, useRef, useState } from 'react'
import { Badge, Button, Checkbox, Input, Select, Spinner, Text } from '@fluentui/react-components'
import {
  ChevronDown16Regular,
  ChevronRight16Regular,
  Document16Regular,
  Folder16Regular,
  FolderOpen16Regular
} from '@fluentui/react-icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileTreeNode } from '../../../shared/model'
import { useAppStore } from '../store/app-store'

type Props = { projectId: string }
type InclusionFilter = 'all' | 'included' | 'excluded'

const EMPTY_SELECTED_PATHS = new Set<string>()

export function FileTree({ projectId }: Props): React.JSX.Element {
  const scan = useAppStore((state) => state.scans[projectId])
  const selected = useAppStore((state) => state.selectedPaths[projectId] ?? EMPTY_SELECTED_PATHS)
  const togglePath = useAppStore((state) => state.togglePath)
  const scanProject = useAppStore((state) => state.scanProject)
  const showHidden = useAppStore((state) => state.config?.settings.showHiddenFiles ?? true)
  const mutateConfig = useAppStore((state) => state.mutateConfig)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [extension, setExtension] = useState('')
  const [inclusion, setInclusion] = useState<InclusionFilter>('all')
  const scrollRef = useRef<HTMLDivElement>(null)

  const descendantStats = useMemo(() => {
    const result = new Map<string, { selected: number; total: number }>()
    for (const node of scan?.nodes ?? []) {
      if (node.kind !== 'file' || !node.selectable) continue
      const parts = node.relativePath.split('/').slice(0, -1)
      for (let depth = 1; depth <= parts.length; depth += 1) {
        const folder = parts.slice(0, depth).join('/')
        const stats = result.get(folder) ?? { selected: 0, total: 0 }
        stats.total += 1
        if (selected.has(node.relativePath)) stats.selected += 1
        result.set(folder, stats)
      }
    }
    return result
  }, [scan, selected])

  const visible = useMemo(() => {
    if (!scan) return []
    const query = search.trim().toLocaleLowerCase('en-US')
    const extensionFilter = extension.trim().replace(/^\./, '').toLocaleLowerCase('en-US')
    const matchesPresentation = (node: FileTreeNode): boolean => {
      if (
        !showHidden &&
        (node.hidden || node.relativePath.split('/').some((part) => part.startsWith('.')))
      )
        return false
      if (
        query &&
        !node.name.toLocaleLowerCase('en-US').includes(query) &&
        !node.relativePath.toLocaleLowerCase('en-US').includes(query)
      )
        return false
      if (
        node.kind === 'file' &&
        extensionFilter &&
        !node.name.toLocaleLowerCase('en-US').endsWith(`.${extensionFilter}`)
      )
        return false
      if (node.kind === 'file' && inclusion === 'included' && !selected.has(node.relativePath))
        return false
      if (node.kind === 'file' && inclusion === 'excluded' && selected.has(node.relativePath))
        return false
      return true
    }
    const matchingFiles = new Set(
      scan.nodes.filter(matchesPresentation).map((node) => node.relativePath)
    )
    const forcedParents = new Set<string>()
    if (query || extensionFilter || inclusion !== 'all') {
      for (const value of matchingFiles) {
        const parts = value.split('/')
        for (let index = 1; index < parts.length; index += 1)
          forcedParents.add(parts.slice(0, index).join('/'))
      }
    }
    return scan.nodes.filter((node) => {
      if (
        !showHidden &&
        (node.hidden || node.relativePath.split('/').some((part) => part.startsWith('.')))
      )
        return false
      const parents = node.relativePath.split('/').slice(0, -1)
      let current = ''
      for (const part of parents) {
        current = current ? `${current}/${part}` : part
        if (!expanded.has(current) && !forcedParents.has(current)) return false
      }
      if (node.kind === 'directory')
        return !query && !extensionFilter && inclusion === 'all'
          ? true
          : forcedParents.has(node.relativePath) || matchingFiles.has(node.relativePath)
      return matchingFiles.has(node.relativePath)
    })
  }, [scan, search, extension, inclusion, showHidden, expanded, selected])

  // TanStack Virtual intentionally owns mutable measurement functions; rows remain isolated here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12
  })

  if (!scan || scan.status === 'idle' || (scan.status === 'scanning' && scan.nodes.length === 0))
    return (
      <div className="center-state">
        <Spinner label="Scanning the complete project…" />
      </div>
    )
  if (scan.status === 'error')
    return (
      <div className="center-state">
        <Text>{scan.error}</Text>
        <Button onClick={() => void scanProject(projectId)}>Retry</Button>
      </div>
    )

  return (
    <section className="file-tree" aria-label="Project file tree">
      <div className="tree-toolbar">
        <Input
          value={search}
          onChange={(_, data) => setSearch(data.value)}
          placeholder="Search filename or path"
          aria-label="Search files"
        />
        <Input
          value={extension}
          onChange={(_, data) => setExtension(data.value)}
          placeholder="Extension"
          aria-label="Filter by extension"
          className="extension-filter"
        />
        <Select
          value={inclusion}
          onChange={(_, data) => setInclusion(data.value as InclusionFilter)}
          aria-label="Filter by selection"
        >
          <option value="all">All files</option>
          <option value="included">Included</option>
          <option value="excluded">Excluded</option>
        </Select>
        <Checkbox
          checked={showHidden}
          onChange={(_, data) =>
            void mutateConfig((config) => {
              config.settings.showHiddenFiles = data.checked === true
            })
          }
          label="Show Hidden Files"
        />
        <Button size="small" onClick={() => void scanProject(projectId, true)}>
          Refresh
        </Button>
        {scan.status === 'scanning' && (
          <Spinner size="tiny" aria-label="Refreshing project files" />
        )}
      </div>
      {scan.warnings.length > 0 && (
        <div className="scan-warning" title={scan.warnings.join('\n')}>
          {scan.warnings.length} filesystem warning(s)
        </div>
      )}
      <div ref={scrollRef} className="tree-scroll" role="tree" aria-label="Files">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const node = visible[item.index]!
            const isFolder = node.kind === 'directory'
            const open = expanded.has(node.relativePath)
            const stats = isFolder ? descendantStats.get(node.relativePath) : undefined
            const checked = isFolder
              ? !!stats && stats.total > 0 && stats.selected === stats.total
              : selected.has(node.relativePath)
            return (
              <div
                key={node.id}
                className={`tree-row ${node.binary ? 'binary' : ''}`}
                style={{
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 8 + node.depth * 18
                }}
                role="treeitem"
                aria-level={node.depth + 1}
              >
                {isFolder ? (
                  <Button
                    appearance="transparent"
                    size="small"
                    className="tree-expander"
                    icon={open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current)
                        open ? next.delete(node.relativePath) : next.add(node.relativePath)
                        return next
                      })
                    }
                    aria-label={open ? 'Collapse folder' : 'Expand folder'}
                  />
                ) : (
                  <span className="tree-expander-spacer" />
                )}
                <Checkbox
                  checked={checked}
                  disabled={!node.selectable}
                  onChange={(_, data) =>
                    togglePath(projectId, node.relativePath, data.checked === true)
                  }
                  aria-label={`${checked ? 'Exclude' : 'Include'} ${node.relativePath}`}
                />
                <span className="tree-icon">
                  {isFolder ? (
                    open ? (
                      <FolderOpen16Regular />
                    ) : (
                      <Folder16Regular />
                    )
                  ) : (
                    <Document16Regular />
                  )}
                </span>
                <span className="tree-name" title={node.relativePath}>
                  {node.name}
                </span>
                {node.binary && <span className="tree-reason">Binary file</span>}
                {stats && stats.selected > 0 && stats.selected < stats.total && (
                  <Badge appearance="tint" size="small">
                    {stats.selected}/{stats.total} selected
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="tree-footer">
        {visible.length.toLocaleString()} visible items ·{' '}
        {scan.nodes.filter((node) => node.kind === 'file').length.toLocaleString()} files scanned
      </div>
    </section>
  )
}
