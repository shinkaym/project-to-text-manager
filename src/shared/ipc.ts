import { z } from 'zod'
import { appConfigSchema, conversionRequestSchema, frameworkIdSchema, sessionSchema } from './model'

export { IPC, eventChannels } from './ipc-channels'

export const projectAddSchema = z.object({
  token: z.string().uuid(),
  framework: frameworkIdSchema,
  groupId: z.string().nullable()
})
export const projectRelinkSchema = z.object({
  projectId: z.string().min(1),
  token: z.string().uuid(),
  framework: frameworkIdSchema
})
export const projectScanSchema = z.object({
  projectId: z.string().min(1),
  profileId: z.string().min(1)
})
export const projectIdSchema = z.string().min(1)
export const watcherSyncSchema = z.array(z.string().min(1)).max(100)
export const closeActionSchema = z.enum(['save', 'discard', 'cancel'])
export { appConfigSchema, conversionRequestSchema, sessionSchema }
