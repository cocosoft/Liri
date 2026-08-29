// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
  parseSchedule,
  scheduleToCron,
  normalizeSchedule,
  scheduleToDisplayText,
} from './cron';
export type { ScheduleKind, ParsedSchedule, CronFields } from './cron';
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
// F-10: 任务结果投递
export {
  initializeTaskResultDelivery,
  shutdownTaskResultDelivery,
} from './TaskResultDeliverer';

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
  return true;
}

// P2-10: Cron 防注入扫描器导出
export { CronInjectionScanner } from './CronInjectionScanner';
export type { ScanResult } from './CronInjectionScanner';

export * from './autoDream';

export * from './delivery';
