export { CronJobStore } from './CronJobStore';
export { CronScheduler } from './CronScheduler';
export { DeliveryQueue } from './DeliveryQueue';
export { CronRunLog } from './CronRunLog';
export { createCronExecutor } from './CronExecutor';
export type { CronExecutorConfig } from './CronExecutor';
export { CronTimer } from './CronTimer';
export {
  isTopOfHourCronExpr,
  resolveStaggerOffsetMs,
  resolveCronStaggerMs,
} from './CronStagger';
export { CronAlertService } from './CronAlertService';
export {
  ensureGlobalCronSchedulerStarted,
  getGlobalCronScheduler,
  isGlobalCronSchedulerStarted,
  stopGlobalCronScheduler,
  wakeGlobalCronScheduler,
} from './GlobalCronScheduler';
export type { CronAlertConfig, AlertCallback } from './CronAlertService';
export type { CronRunLogEntry, CronRunLogPage } from './CronRunLog';
// 2026-10-01 D-161（`R00-001`）：cron 求值工具**整模块搬迁**至 `utils/cron.ts`（infra）
// —— `monitoring`(infra) 亦需 `computeNextCronRunMs`，留在 tasks(app) 会构成 infra -> app
// 倒挂。此处继续转出，保持 `@modules/tasks` 既有出口稳定（app 侧调用方零改动）。
export {
  computeNextCronRun,
  computeNextCronRunMs,
  computePreviousCronRunMs,
  computeMissedRuns,
  isValidCronExpr,
  getCronDescription,
} from '@modules/utils/cron';
export type {
  DeliveryQueueConfig,
  DeliveryQueueEntry,
  DeliveryPayload,
  DeliveryQueueStats,
} from './DeliveryQueue';
export type {
  JobExecutor,
  DeliveryDispatcher,
  SchedulerCallbacks,
} from './CronScheduler';
export type {
  CronJob,
  CronSchedule,
  CronRepeat,
  CronOrigin,
  CronJobState,
  CronRunStatus,
  CronJobResult,
  CronJobFilter,
  CronSchedulerConfig,
  CronSchedulerStatus,
  ICronScheduler,
} from './types';

export {
  CRON_JOB_STATE_TRANSITIONS,
  isTerminalCronState,
  isValidCronTransition,
  validateCronTransition,
} from './types';
