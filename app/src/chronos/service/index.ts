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
export { SqliteCronStore, createSqliteCronStore } from './SqliteCronStore';

export { ConfigService, configService } from './ConfigService';
export type {
  ConfigItem,
  ConfigChangeEvent,
  ConfigStats,
} from './ConfigService';

export {
  ExecutionHistoryService,
  executionHistoryService,
} from './ExecutionHistoryService';
export type {
  ExecutionHistoryRecord,
  ExecutionHistoryQuery,
  ExecutionHistoryStats,
  CleanupConfig,
} from './ExecutionHistoryService';

export { SessionTaskService, sessionTaskService } from './SessionTaskService';
export type {
  SessionTask,
  SessionTaskEvent,
  SessionTaskStats,
} from './SessionTaskService';

export {
  StorageOptimizationService,
  storageOptimizationService,
} from './StorageOptimizationService';
export type { StorageConfig, StorageStats } from './StorageOptimizationService';

export {
  TaskExpirationService,
  taskExpirationService,
} from './TaskExpirationService';
export type {
  Task,
  TaskExpiredEvent,
  ExpirationStats,
} from './TaskExpirationService';

export { TaskJitterService, taskJitterService } from './TaskJitterService';
export type { CronJitterConfig } from './TaskJitterService';

export { TaskScheduler, taskScheduler } from './TaskScheduler';
export type {
  ScheduledTask,
  TaskSchedulerOptions,
  SchedulerStats,
} from './TaskScheduler';
