import { useState } from 'react'
import { Badge, Button, ProgressBar, Text } from '@fluentui/react-components'
import type { ConversionTask } from '../../../shared/model'
import { useAppStore } from '../store/app-store'

const badgeColor = (
  status: ConversionTask['status']
): 'brand' | 'success' | 'danger' | 'warning' | 'informative' => {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'cancelled') return 'warning'
  return status === 'running' ? 'brand' : 'informative'
}

export function TasksView(): React.JSX.Element {
  const tasks = useAppStore((state) => state.tasks)
  const [selectedId, setSelectedId] = useState<string | null>(tasks[0]?.id ?? null)
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0]
  return (
    <main className="tasks-view">
      <div className="view-header">
        <div>
          <h1>Tasks / Logs</h1>
          <Text>Queued and running conversions only. Completed tasks are removed immediately.</Text>
        </div>
      </div>
      <div className="tasks-layout">
        <div className="task-list">
          {tasks.map((task) => (
            <button
              key={task.id}
              className={`task-card ${selected?.id === task.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(task.id)}
            >
              <div>
                <strong>{task.projectName}</strong>
                <span>{task.profileName}</span>
              </div>
              <Badge color={badgeColor(task.status)}>{task.status}</Badge>
              {task.status === 'running' && (
                <>
                  <ProgressBar value={task.progress / 100} />
                  <small>
                    {task.progress}% · {task.processedCount}/{task.totalCount} files
                  </small>
                  {task.currentFile && <small title={task.currentFile}>{task.currentFile}</small>}
                </>
              )}
              {task.outputPath && <small title={task.outputPath}>{task.outputPath}</small>}
              {['queued', 'running'].includes(task.status) && (
                <Button
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation()
                    void window.desktop.conversion.cancel(task.id)
                  }}
                >
                  Cancel
                </Button>
              )}
            </button>
          ))}
          {tasks.length === 0 && (
            <div className="center-state">No conversion tasks in this session.</div>
          )}
        </div>
        <TaskLog task={selected} />
      </div>
    </main>
  )
}

export function TaskLog({ task }: { task?: ConversionTask }): React.JSX.Element {
  return (
    <div className="task-log" role="log" aria-label="Conversion log">
      {task ? (
        <>
          {task.logs.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className={`log-line ${entry.level}`}>
              <time>{new Date(entry.at).toLocaleTimeString()}</time>
              <span>{entry.message}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="log-placeholder">Select a task to inspect its active lifecycle log.</div>
      )}
    </div>
  )
}
