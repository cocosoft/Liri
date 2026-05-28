/**
 * Chronos后台常驻系统 - 导出模块
 */

export type { TaskStatus as ChronosTaskStatus } from './types';
export type {
  ScheduledTask,
  CronSchedulerOptions,
  CronJitterConfig,
  CronScheduler as CronSchedulerInterface,
  InMemorySchedulerOptions,
  InMemoryScheduler,
} from './types';
export { ChronosDatabase } from './ChronosDatabase';
export {
  parseCronExpression,
  computeNextCronRun,
  cronToHuman,
  isValidCronExpression,
} from './cron';
export {
  DEFAULT_CRON_JITTER_CONFIG,
  jitteredNextCronRunMs,
  isTaskExpired,
  getJitterConfig,
  setJitterConfig,
} from './cronJitterConfig';
export {
  ChronosRemoteTrigger,
  PushNotificationService,
  DEFAULT_TRIGGER_CONFIG,
} from './ChronosRemoteTrigger';
export type {
  RemoteTriggerConfig,
  TriggerResult,
} from './ChronosRemoteTrigger';
export {
  readCronTasksFile,
  writeCronTasksFile,
  hasCronTasksSync,
  addCronTask,
  removeCronTasks,
  markCronTasksFired,
  listAllCronTasks,
  nextCronRunMs,
  findMissedTasks,
  getCronTask,
  updateCronTask,
  setCronSqliteStore,
} from './CronTasks';
export {
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
  isLockHeld,
} from './CronTasksLock';
export {
  createCronScheduler,
  buildMissedTaskNotification,
  createInMemoryScheduler,
} from './CronScheduler';

// 执行引擎
export * from './engine';

// 生命周期管理
export * from './lifecycle';

// SQLite 持久化存储
export {
  SqliteCronStore,
  createSqliteCronStore,
} from './service/SqliteCronStore';
export type { CronRun } from './service/SqliteCronStore';

// 增强任务
export type {
  EnhancedCronTask,
  TaskExecutionStatus,
  RetryPolicy,
  TaskExecutionRecord,
} from './EnhancedCronTask';
export {
  createEnhancedCronTask,
  DEFAULT_RETRY_POLICY,
  canRetryTask,
  calculateNextRetryTime,
  checkTaskDependencies,
} from './EnhancedCronTask';

// 子进程隔离执行器
export {
  CronSubprocessExecutor,
  getCronSubprocessExecutor,
} from './CronSubprocessExecutor';
export type {
  SubprocessTaskConfig,
  SubprocessTaskResult,
  SubprocessStatus,
} from './CronSubprocessExecutor';

// 事件驱动触发
export {
  CronEventTrigger,
  cronEventTrigger,
} from './event-driven/CronEventTrigger';
export type {
  TriggerEvent,
  TriggerRule,
} from './event-driven/CronEventTrigger';

// Lost task 检测
export { CronLostTaskDetector } from './recovery/CronLostTaskDetector';
export type { MissedTaskInfo } from './recovery/CronLostTaskDetector';

// 执行报告生成
export {
  CronReportGenerator,
  cronReportGenerator,
} from './reporting/CronReportGenerator';
export type {
  CronExecutionSummary,
  TaskExecutionStats,
  CronReport,
} from './reporting/CronReportGenerator';

// 文件系统监听
export { CronFileWatcher, cronFileWatcher } from './watcher/CronFileWatcher';
export type { CronFileChangeCallback } from './watcher/CronFileWatcher';

// 知识库维护
export {
  runKnowledgeMaintenance,
  registerKnowledgeMaintenanceTask,
  unregisterKnowledgeMaintenanceTask,
  DEFAULT_MAINTENANCE_CRON,
  KNOWLEDGE_MAINTENANCE_TASK_ID,
} from './knowledge';
export type { KnowledgeMaintenanceResult } from './knowledge';

/**
 * 检查Chronos系统是否处于活跃状态
 */
export function isChronosActive(): boolean {
  // 这里可以根据实际情况实现检查逻辑
  // 例如检查环境变量、配置文件或系统状态
  return true;
}
