/**
 * 归档模块导出
 */

export {
  DataArchivalStrategy,
  ArchiveDataType,
} from './DataArchivalStrategy.js';

export type {
  ArchiveMetadata,
  ArchiveFileInfo,
  ArchiveResult,
  CleanupResult,
  RetentionPolicies,
  ArchivalConfig,
} from './DataArchivalStrategy.js';

export {
  DEFAULT_ARCHIVAL_CRON,
  ARCHIVAL_TASK_ID,
  executeArchivalMaintenance,
  setupArchivalScheduler,
  stopArchivalScheduler,
  registerArchivalCronTask,
  unregisterArchivalCronTask,
} from './archivalCronTask.js';

export type {
  ArchivalMaintenanceResult,
  ArchivalSchedulerConfig,
} from './archivalCronTask.js';
