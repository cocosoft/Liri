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
 * 任务系统模块
 */

// 导出类型
export type { TaskStatus, TaskType, TaskState } from './types';
export type {
  TaskContext,
  TaskEvent,
  AgentProgress,
  ToolActivity,
} from './types';

// 导出任务基类
export { BaseTask } from './BaseTask';

// 导出本地Bash任务
export {
  looksLikePrompt,
  LocalBashTaskOptions,
  LocalBashTask,
} from './LocalBashTask';

// 导出轻量笔记任务
export { NoteTask } from './NoteTask';

// 导出任务注册表（含便利方法）
export { TaskRegistry, taskRegistry } from './TaskRegistry';
export type { TaskInfo, TaskStats, DisplayStatus } from './TaskRegistry';
export { displayToTaskStatus, taskStatusToDisplay } from './TaskRegistry';

// 导出其他任务类型
// @deprecated LocalAgentTask 已废弃 — launchAgent() 返回 mock 对象，将在未来版本中删除
// export { LocalAgentTask } from './LocalAgentTask';
export { RemoteAgentTask } from './RemoteAgentTask';
export { DreamTask } from './DreamTask';
export { LocalWorkflowTask } from './LocalWorkflowTask';
export { MonitorMcpTask } from './MonitorMcpTask';
export { stopTask } from './stopTask';
export { InProcessTeammateTask } from './InProcessTeammateTask';

// 导出 BackgroundAgentTask 适配器
export {
  BackgroundAgentTask,
  backgroundTaskInfoToTaskState,
} from './BackgroundAgentTask';

// 导出 TaskOrchestrator
export { TaskOrchestrator, taskOrchestrator } from './TaskOrchestrator';
export type { Plan, PlanStep, PlanProgress } from './TaskOrchestrator';

// 导出 SQLite 持久化存储
export { SqliteTaskStore, createSqliteTaskStore } from './db/SqliteTaskStore';
export type { TaskRun, SearchResult } from './db/SqliteTaskStore';
export { SCHEMA, FTS5_SCHEMA, TABLE_NAMES } from './db/schema';

// 导出任务流编排
export { TaskFlowRegistry, taskFlowRegistry } from './TaskFlowRegistry';

// 导出依赖链服务
export { TaskDependencyService } from './TaskDependencyService';

// 导出通知服务
export { TaskNotificationService } from './TaskNotificationService';
export type { DeliveryRecord } from './types';

// 导出一致性核对
export { TaskReconciliationService } from './TaskReconciliationService';
export type {
  ReconciliationIssue,
  ReconciliationResult,
} from './TaskReconciliationService';

// 导出分离式运行时
export { DetachedTaskRuntime } from './DetachedTaskRuntime';
export type {
  DetachedTaskConfig,
  DetachedTaskResult,
} from './DetachedTaskRuntime';

// 导出投递适配器
export { TaskDeliveryAdapter } from './TaskDeliveryAdapter';
export type { TaskDeliveryConfig } from './TaskDeliveryAdapter';

// 导出持久化任务队列
export { PersistentTaskQueue } from './PersistentTaskQueue';
export type {
  QueueEntry,
  QueueStats,
  QueueStatus,
} from './PersistentTaskQueue';

// 导出多阶段梦境
export {
  MultiPhaseDreamExecutor,
  isToolReadOnly,
  DREAM_PHASE_DEFAULTS,
} from './dream/DreamPhases';
export type {
  DreamPhase,
  DreamPhaseConfig,
  MultiPhaseDreamResult,
  DreamPhaseProgressCallback,
} from './dream/DreamPhases';

// 导出通用 task 接口类型
export type {
  TaskPriority,
  Task,
  TaskCreateOptions,
  TaskUpdateOptions,
  TaskQueryOptions,
  TaskStorage,
  TaskService,
  TaskExecutor,
  TaskQueue,
} from './types';

// 导出审计、维护、状态服务
export { TaskAuditService } from './TaskAuditService';
export { TaskMaintenanceService } from './TaskMaintenanceService';
export { TaskStatusService } from './TaskStatusService';
export type { SnapshotOptions, TaskStatusSnapshot } from './types';

// 导出生命周期追踪
export { LifecycleTracker } from './LifecycleTracker';
export type { LifecyclePhase, LifecycleEvent, ILifecycleTask } from './LifecycleTracker';

// 导出监控任务
export { MonitorTask } from './MonitorTask';
export type { MonitorTarget } from './MonitorTask';

// 导出 PDCA 编排器
export { LongRunningTaskOrchestrator, getOrCreateOrchestrator, getOrchestrator, getAllOrchestrators } from './LongRunningTaskOrchestrator';
export type { PdcaPhase, PdcaStatus } from './LongRunningTaskOrchestrator';
export { generateAuditReport } from './AuditReport';
export type { AuditReport, AuditStepEntry } from './AuditReport';
export { parseReviewFromText, isReviewPassed, formatReviewSummary } from './PlanReview';
export type { PlanReview, ReviewIssue, ReviewDecision } from './PlanReview';

// 导出 Curator 审查范围扩展
export { CuratorReviewScope, curatorReviewScope } from '../tools/AgentTool/CuratorReviewScope';
export type { ExtendedReviewResult, FileReviewTarget, MemoryReviewTarget, ConfigReviewTarget, CuratorScopeConfig } from '../tools/AgentTool/CuratorReviewScope';
