import { randomUUID } from 'node:crypto'
import type { ConversionRequest, ConversionTask, TaskLog } from '../../shared/model'
import { convertToFile } from './converter'
import type { ConfigStore } from './config-store'
import { OutputReservations } from './output-reservations'
import { PreflightService } from './preflight'

type RuntimeCallbacks = {
  changed: (tasks: ConversionTask[]) => void
  notify: (title: string, body: string, windows: boolean) => void
}

type RuntimeEntry = {
  task: ConversionTask
  request: ConversionRequest
  controller: AbortController
}

export class TaskRuntime {
  private readonly entries: RuntimeEntry[] = []
  private readonly reservations = new OutputReservations()
  private running = 0
  private readonly runningProjectIds = new Set<string>()
  private readonly executions = new Set<Promise<void>>()

  constructor(
    private readonly store: ConfigStore,
    private readonly preflight: PreflightService,
    private readonly callbacks: RuntimeCallbacks,
    private readonly autoConcurrency: number
  ) {}

  list(): ConversionTask[] {
    return structuredClone(this.entries.map((entry) => entry.task))
  }

  async enqueue(request: ConversionRequest): Promise<ConversionTask> {
    const config = (await this.store.load()).config
    const project = config.projects.find((candidate) => candidate.id === request.projectId)
    const profile = project?.profiles.find((candidate) => candidate.id === request.profileId)
    if (!project || !profile) throw new Error('Project or profile not found')
    const result = await this.preflight.run(config, request)
    if (!result.valid)
      throw new Error(
        result.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('\n')
      )
    const task: ConversionTask = {
      id: randomUUID(),
      projectId: project.id,
      projectName: project.displayName,
      profileName: profile.name,
      status: 'queued',
      progress: 0,
      processedCount: 0,
      totalCount: request.selectedFiles.length,
      createdAt: new Date().toISOString(),
      logs: [this.log('info', 'Queued')]
    }
    this.entries.push({ task, request, controller: new AbortController() })
    this.emit()
    void this.drain()
    return structuredClone(task)
  }

  cancel(taskId: string): void {
    const index = this.entries.findIndex((candidate) => candidate.task.id === taskId)
    if (index < 0) return
    const entry = this.entries[index]!
    if (['completed', 'failed', 'cancelled'].includes(entry.task.status)) return
    entry.controller.abort()
    if (entry.task.status === 'queued') {
      this.entries.splice(index, 1)
      this.emit()
    }
  }

  clearFinished(): ConversionTask[] {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (['completed', 'failed', 'cancelled'].includes(this.entries[index]!.task.status))
        this.entries.splice(index, 1)
    }
    this.emit()
    return this.list()
  }

  private async drain(): Promise<void> {
    const setting = (await this.store.load()).config.settings.taskConcurrency
    const concurrency = setting === 'auto' ? this.autoConcurrency : setting
    while (this.running < concurrency) {
      const next = this.entries.find(
        (entry) =>
          entry.task.status === 'queued' && !this.runningProjectIds.has(entry.task.projectId)
      )
      if (!next) break
      this.running += 1
      this.runningProjectIds.add(next.task.projectId)
      const execution = this.run(next)
      this.executions.add(execution)
      void execution.finally(() => {
        this.executions.delete(execution)
        this.running -= 1
        this.runningProjectIds.delete(next.task.projectId)
        void this.drain()
      })
    }
  }

  async cancelAllAndWait(): Promise<void> {
    for (const entry of this.entries) entry.controller.abort()
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index]!.task.status === 'queued') this.entries.splice(index, 1)
    }
    this.emit()
    await Promise.allSettled([...this.executions])
  }

  private async run(entry: RuntimeEntry): Promise<void> {
    const { task, request, controller } = entry
    let reservedPath: string | undefined
    try {
      const config = (await this.store.load()).config
      const project = config.projects.find((candidate) => candidate.id === request.projectId)
      if (!project) throw new Error('Project was removed')
      const preflight = await this.preflight.run(config, request)
      if (!preflight.valid)
        throw new Error(
          preflight.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join('; ')
        )
      reservedPath = await this.reservations.reserve(preflight.outputPath, request.overwrite)
      task.outputPath = reservedPath
      task.status = 'running'
      task.startedAt = new Date().toISOString()
      task.logs.push(this.log('info', `Writing ${reservedPath}`))
      this.emit()
      await convertToFile(project, request, reservedPath, {
        signal: controller.signal,
        log: (level, message) => {
          task.logs.push(this.log(level, message))
          this.emit()
        },
        progress: (progress, currentFile, processedCount, totalCount) => {
          task.progress = progress
          task.currentFile = currentFile
          task.processedCount = processedCount
          task.totalCount = totalCount
          this.emit()
        }
      })
      task.status = 'completed'
      task.progress = 100
      task.finishedAt = new Date().toISOString()
      task.logs.push(this.log('info', 'Conversion completed'))
      this.emit()
      this.callbacks.notify(
        'Conversion completed',
        `${task.projectName} → ${reservedPath}`,
        config.settings.notificationsEnabled
      )
    } catch (error) {
      task.status = controller.signal.aborted ? 'cancelled' : 'failed'
      task.error = (error as Error).message
      task.finishedAt = new Date().toISOString()
      task.logs.push(this.log(task.status === 'cancelled' ? 'warning' : 'error', task.error))
      this.emit()
      const config = (await this.store.load()).config
      this.callbacks.notify(
        task.status === 'cancelled' ? 'Conversion cancelled' : 'Conversion failed',
        `${task.projectName}: ${task.error}`,
        config.settings.notificationsEnabled
      )
    } finally {
      if (reservedPath) this.reservations.release(reservedPath)
      const index = this.entries.indexOf(entry)
      if (index >= 0) this.entries.splice(index, 1)
      this.emit()
    }
  }

  private log(level: TaskLog['level'], message: string): TaskLog {
    return { at: new Date().toISOString(), level, message }
  }
  private emit(): void {
    this.callbacks.changed(this.list())
  }
}
