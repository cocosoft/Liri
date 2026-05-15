import { Type, type Static } from '@sinclair/typebox';

export const CronScheduleSchema = Type.Object({
  expression: Type.String({ minLength: 1 }),
  timezone: Type.Optional(Type.String({ default: 'UTC' })),
  startAt: Type.Optional(Type.Number()),
  endAt: Type.Optional(Type.Number()),
});

export const CronJobSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  schedule: CronScheduleSchema,
  task: Type.String({ minLength: 1 }),
  enabled: Type.Optional(Type.Boolean({ default: true })),
  maxRetries: Type.Optional(Type.Integer({ minimum: 0, default: 3 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 100, default: 30000 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const CronResultSchema = Type.Object({
  jobId: Type.String({ minLength: 1 }),
  executedAt: Type.Number(),
  durationMs: Type.Number({ minimum: 0 }),
  success: Type.Boolean(),
  output: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  nextRunAt: Type.Optional(Type.Number()),
});

export type CronSchedule = Static<typeof CronScheduleSchema>;
export type CronJob = Static<typeof CronJobSchema>;
export type CronResult = Static<typeof CronResultSchema>;
