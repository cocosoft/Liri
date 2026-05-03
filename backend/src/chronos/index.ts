// @ts-nocheck
/**
 * Chronos后台常驻系统 - 导出模块
 */

export * from './types';
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
} from './CronTasks';
export {
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
  isLockHeld,
} from './CronTasksLock';
export {
  createCronScheduler,
  buildMissedTaskNotification,
} from './CronScheduler';

// 执行引擎
export * from './engine';

// 生命周期管理
export * from './lifecycle';

// 增强调度器
export { EnhancedCronScheduler } from './EnhancedCronScheduler';

// 增强任务
export type { EnhancedCronTask, TaskExecutionStatus, RetryPolicy, TaskExecutionRecord } from './EnhancedCronTask';
export {
  createEnhancedCronTask,
  DEFAULT_RETRY_POLICY,
  canRetryTask,
  calculateNextRetryTime,
  checkTaskDependencies,
} from './EnhancedCronTask';

// 增强任务调度器
export { EnhancedTaskScheduler } from './EnhancedTaskScheduler';
export type { EnhancedSchedulerOptions } from './EnhancedTaskScheduler';

/**
 * 检查Chronos系统是否处于活跃状态
 */
export function isChronosActive(): boolean {
  // 这里可以根据实际情况实现检查逻辑
  // 例如检查环境变量、配置文件或系统状态
  return true;
}
