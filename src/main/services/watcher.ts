import chokidar, { type FSWatcher } from 'chokidar'
import type { AppConfig } from '../../shared/model'
import { BUILT_IN_HARD_EXCLUDES, PRESETS } from '../../shared/presets'

type WatchEntry = { watcher: FSWatcher; paths: Set<string>; timer?: NodeJS.Timeout }

export class ProjectWatcherService {
  private readonly entries = new Map<string, WatchEntry>()

  constructor(private readonly onBatch: (projectId: string, paths: string[]) => void) {}

  async sync(config: AppConfig, projectIds: string[]): Promise<void> {
    const desired = new Set(config.settings.watcherEnabled ? projectIds : [])
    for (const [projectId, entry] of this.entries) {
      if (!desired.has(projectId)) {
        await entry.watcher.close()
        if (entry.timer) clearTimeout(entry.timer)
        this.entries.delete(projectId)
      }
    }
    for (const projectId of desired) {
      if (this.entries.has(projectId)) continue
      const project = config.projects.find((candidate) => candidate.id === projectId)
      if (!project) continue
      const ignoredNames = new Set([
        ...BUILT_IN_HARD_EXCLUDES,
        ...PRESETS[project.framework].hardExcludeDirectories
      ])
      const watcher = chokidar.watch(project.path, {
        ignoreInitial: true,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
        ignored: (target) => target.split(/[\\/]/).some((segment) => ignoredNames.has(segment))
      })
      const entry: WatchEntry = { watcher, paths: new Set() }
      const collect = (changedPath: string): void => {
        entry.paths.add(changedPath)
        if (entry.timer) clearTimeout(entry.timer)
        const delay = entry.paths.size > 20 ? 800 : 150
        entry.timer = setTimeout(() => {
          const paths = [...entry.paths]
          entry.paths.clear()
          this.onBatch(projectId, paths)
        }, delay)
      }
      watcher.on('all', (_event, changedPath) => collect(changedPath))
      this.entries.set(projectId, entry)
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => entry.watcher.close()))
    this.entries.clear()
  }
}
