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
export { looksLikePrompt, LocalBashTask } from './LocalBashTask';
export type { LocalBashTaskOptions } from './LocalBashTask';

// 导出轻量笔记任务
export { NoteTask } from './NoteTask';

// 导出任务注册表（含便利方法）
export { TaskRegistry, taskRegistry } from './TaskRegistry';
export type { TaskInfo, TaskStats, DisplayStatus } from './TaskRegistry';
export { displayToTaskStatus, taskStatusToDisplay } from './TaskRegistry';

// 导出其他任务类型
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

// 2026-10-01 D-144：PlanDrivenLoop 自 core 移入本层（消除 core → app 倒挂）
export {
  PlanDrivenLoop,
  classifyTaskComplexity,
  hasDangerousToolIntent,
  isEligibleForFastPath,
} from './PlanDrivenLoop';
export type {
  PlanDrivenLoopResult,
  PlanDrivenLoopConfig,
} from './PlanDrivenLoop';
// T-②05（2026-10-03）：快速路径判据的**运行时解析**（读 GlobalConfig.fastPath，缺省回退默认）
export { resolveFastPathPolicy } from './fastPathPolicy';
// T-②06（2026-10-03）：经验自动演化 —— 审计落盘出口（`ChatManager` 注入）+ 编排入口
export { setEvolutionAuditSink } from './evolution/EvolutionAudit';
export {
  runAdaptationEvolution,
  createEvolutionDeps,
} from './evolution/AdaptationEvolutionService';
export type {
  EvolutionRunResult,
  EvolutionDeps,
} from './evolution/AdaptationEvolutionService';
export { scheduleTopoBatches, computeTopoSkips } from './topoBatches';
export type {
  TopoBatchTask,
  TopoDependencyMode,
  TopoTaskStatus,
} from './topoBatches';
export {
  PitfallRegistry,
  pitfallRegistry,
  normalizePitfallKey,
} from './pitfalls/PitfallRegistry';
export type {
  PitfallEntry,
  PitfallRecordInput,
  PitfallSource,
} from './pitfalls/PitfallRegistry';

// 导出 SQLite 持久化存储
export { SqliteTaskStore, createSqliteTaskStore } from './db/SqliteTaskStore';
export type { TaskRun, SearchResult } from './db/SqliteTaskStore';
export { TASKS_SCHEMA, FTS5_SCHEMA, TABLE_NAMES } from './db/schema';
export { goalMetricsService } from './db/GoalMetricsService';
export type { GoalMetricsService as GoalMetricsServiceType } from './db/GoalMetricsService';

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

// 导出审计、状态服务
export { TaskAuditService } from './TaskAuditService';
export { TaskStatusService } from './TaskStatusService';
export type { SnapshotOptions, TaskStatusSnapshot } from './types';

// 导出生命周期追踪
export { LifecycleTracker } from './LifecycleTracker';
export type {
  LifecyclePhase,
  LifecycleEvent,
  ILifecycleTask,
} from './LifecycleTracker';

// 导出监控任务
export { MonitorTask } from './MonitorTask';
export type { MonitorTarget } from './MonitorTask';

// 导出 PDCA 编排器
export {
  LongRunningTaskOrchestrator,
  getOrCreateOrchestrator,
  getOrchestrator,
  getAllOrchestrators,
  setStepLoopFactory,
} from './LongRunningTaskOrchestrator';
export type {
  PdcaPhase,
  PdcaStatus,
  PdcaMetrics,
  StepLoopFactory,
} from './LongRunningTaskOrchestrator';
// P2（2026-11-04，方案 §3.3）：长程策略快照的会话侧端口（chat 装配期注册一次）
export { setTaskSessionPolicyPort } from './lro/taskSessionPolicyPort';
export type { TaskSessionPolicyPort } from './lro/taskSessionPolicyPort';
export type {
  PolicyReplayPatch,
  PolicySnapshotInput,
  TaskPolicySnapshot,
} from './lro/policySnapshot';
export { generateAuditReport } from './AuditReport';
export type { AuditReport, AuditStepEntry } from './AuditReport';
export {
  parseReviewFromText,
  isReviewPassed,
  formatReviewSummary,
} from './PlanReview';
export type { PlanReview, ReviewIssue, ReviewDecision } from './PlanReview';

// 导出 Curator 审查范围扩展
export { CuratorReviewScope, curatorReviewScope } from '@modules/tools';
export type {
  ExtendedReviewResult,
  FileReviewTarget,
  MemoryReviewTarget,
  ConfigReviewTarget,
  CuratorScopeConfig,
} from '@modules/tools';

// CG3 自主执行闭环
export {
  createCg3Services,
  wireSelfWakeToCron,
  wireAlwaysOnToChat,
  startCg3,
  getCg3,
} from './Cg3Bootstrap';
export type { Cg3BootstrapResult } from './Cg3Bootstrap';
// U-02（2026-10-20）：AlwaysOn 最小可用自主执行 —— 供 entry 层经模块出口引入（R03-002）
export { AlwaysOnManager } from './alwayson/AlwaysOnManager';
// 默认配置（含自评超时 / 预留 token —— entry 的自评实现读这里，避免魔法数字散落）
export { DEFAULT_ALWAYSON_CONFIG } from './alwayson/types';
export {
  bootstrapAlwaysOn,
  type AlwaysOnProject,
  type AlwaysOnBootstrapDeps,
  type AlwaysOnBootstrapResult,
} from './alwayson/AlwaysOnBootstrap';
export {
  createAlwaysOnBridge,
  type AlwaysOnBridge,
  type AlwaysOnBridgeDeps,
  type AlwaysOnPromptHooks,
  type AlwaysOnUsage,
  type AlwaysOnWorkspaceRef,
  type AlwaysOnWorkspacePrepareResult,
  type AlwaysOnWorkspaceFinishResult,
} from './alwayson/AlwaysOnBridge';
// 目标达成自评（2026-10-20）：纯函数（提示词构造 / 结构化解析）独立成模块，
// 模型调用仍由 entry 注入 ⇒ `tasks` 不依赖 `chat`（R00-001）。
export {
  buildGoalEvaluationPrompt,
  parseGoalEvaluation,
  unverifiedGoal,
  formatGoalAchievementLine,
  type AlwaysOnGoalVerdict,
  type AlwaysOnGoalEvaluation,
  type AlwaysOnGoalPromptInput,
} from './alwayson/goalEvaluator';
// 2026-10-08：删除 `CommandBridge` 再导出 —— 其**唯一**引用方 `AlwaysOnRuntime` 从未注入它
// （取证见该类 `tryRun()` 注释），删除后 `tasks/commands/CommandBridge.ts` 零消费者 ⇒ 一并删除。
// 2026-10-08：删除 `SteeringBridge` 再导出 —— 第二套 steering（`tasks/steering/SteeringBridge` +
// `query/SteeringManager`）实测**零外部消费者**且 `AlwaysOnRuntime.steerBridge` 从未注入/调用 ⇒
// 死代码。steering 现只有一套：`query/ReActLoop.steeringQueue`（见 §1.6 `context/steering` 事件）。
export { cg3DataDir, cg3Log } from './cg3Env';

// P2-9: 批量并行处理导出
export { BatchRunner } from './BatchRunner';
export type {
  BatchConfig,
  BatchWorker,
  BatchProgress,
  BatchItem,
  BatchResult,
} from './BatchRunner';

// P3-1: 任务蓝图目录导出
export {
  findBlueprint,
  renderBlueprintPrompt,
  BUILTIN_BLUEPRINTS,
} from './TaskBlueprintCatalog';
export type { TaskBlueprint, BlueprintSlot } from './TaskBlueprintCatalog';

// P3-13: 任务列表视图导出
export { sortAndFilterTasks, getTaskPillLabel } from './TaskListView';
export type { TaskListViewItem, TaskListViewConfig } from './TaskListView';

// P3-2: 跨进程调度锁
export { CrossProcessLock, createCronLock } from './CrossProcessLock';
export type { CrossProcessLockOptions } from './CrossProcessLock';

export * from './cron';

export * from './PdcaWorkItemBridge.js';

// P33（2026-11-02）：已结束工作项的 Mandate 重校验（消息唤醒前）
export * from './autonomy/revalidate.js';
// P33/P35：自治策略读取（入口侧按 `sources.fs` 决定是否注册 fs 来源）
export { loadAutonomyPolicy } from './autonomy/policyConfig';

// P34（2026-11-02）：工单阶段派生 + 派工记录（方案 §5 P34）
export {
  deriveTicketStage,
  isPersonStage,
  ticketStageKey,
} from './ticketStage';
export type {
  AssignmentStateLike,
  PersonAction,
  ReportStateLike,
  TicketFacts,
  TicketStage,
} from './ticketStage';
export {
  ASSIGNMENT_STATE_RUNNING,
  isActiveAssignmentState,
  // P36-b（2026-11-02）：启动期收尾遗留 running 派工（ownership 投影的根因修复）
  closeOrphanRunningAssignments,
  closeTicketAssignmentStore,
  findWorkItemIdBySession,
  latestTicketAssignment,
  listTicketAssignments,
  listTicketAssignmentsBySession,
  upsertTicketAssignment,
  TICKET_ASSIGNMENTS_TABLE,
} from './ticketAssignmentStore';
export type {
  AssignmentState,
  ReportState,
  TicketAssignmentRecord,
} from './ticketAssignmentStore';
// P36-b（2026-11-02）：装配期收尾遗留 running 派工（ownership 投影的"永不解除持有"根因修复）
export { sweepOrphanAssignments } from './ticketAssignmentRecovery';

// P39（2026-11-02）：驾驶舱读侧聚合（方案 §5 P39）——纯函数；UI/评测集不在本批
export {
  COCKPIT_GROUP_LABELS,
  COCKPIT_GROUP_ORDER,
  buildCockpitSnapshot,
  checkCockpitInvariants,
  isPersonGroupKey,
} from './cockpit';
export type {
  CockpitGroup,
  CockpitItem,
  CockpitMetrics,
  CockpitSnapshot,
} from './cockpit';
export { loadCockpitItems, markActionableAttention } from './cockpit';
export type { CockpitSourceDeps } from './cockpit';
// P39-b-2：完整历史 / 一键接管判定（纯函数）
export { buildCockpitHistory, pickTakeoverSessionId } from './cockpit';
export type {
  CockpitExecutionFact,
  CockpitHistory,
  CockpitWorkItemFact,
} from './cockpit';

// P38（2026-11-02）：统一 effects 队列（方案 §5 P38）——只导出内核，不接线具体分域台账
export { EffectQueue, EFFECT_QUEUE_TABLE } from './effects';
// P38-b-2：`reply` 影子队列（只写不派发；由宿主注入 channels 的影子端口）
export { REPLY_EFFECT_KIND, replyEffectKey, shadowReplyRelay } from './effects';
export type {
  ReplyEffectPayload,
  ReplyShadowInput,
  ReplyShadowQueue,
} from './effects';
// P38-b-3：`reply` 派发运行时（开关开启时由宿主启动扫描器）
export {
  createDefaultReplyDispatchDeps,
  dispatchDueReplies,
  enqueueReplyEffect,
  kickReplyEffectDispatcher,
  setReplyEffectQueueForTest,
  startReplyEffectDispatcher,
} from './effects';
export type { ReplyDispatchDeps } from './effects';
// P39-b-2：effects 计数（面板观测面；单例连接）
export {
  getEffectCounts,
  setEffectCountsQueueForTest,
  toEffectCountsSummary,
} from './effects';
export type { EffectCountsSummary } from './effects';
export {
  EFFECT_CLAIM_STALE_MS,
  EFFECT_DEFAULT_LATER_MS,
  EFFECT_FAILURES_BEFORE_ERROR,
  EFFECT_KIND_MAX_ATTEMPTS,
  EFFECT_KINDS,
  EFFECT_MAX_RETRY_MS,
  EFFECT_RETRY_BASE_MS,
  EFFECT_STATUSES,
  EFFECT_STATUS_ATTEMPTING,
  EFFECT_STATUS_FAILED,
  EFFECT_STATUS_PENDING,
  EFFECT_STATUS_SETTLED,
  effectRetryDelay,
} from './effects';
export type {
  ClaimEffectResult,
  ClaimedEffect,
  EffectEntry,
  EffectKind,
  EffectOutcome,
  EffectStatus,
} from './effects';

// P35（2026-11-02）：Source / Trigger / Thread（方案 §5 P35）。
// 只导出实现，不在此处接线任何来源 —— 生产接线需先补消费者登记（CD02）。
export {
  SourceCursorStore,
  SOURCE_CURSORS_TABLE,
  SOURCE_TRIGGERS_TABLE,
} from './sources/cursor';
export { SourceRegistry } from './sources/registry';
export type { SourceRegistryOptions, TriggerHandler } from './sources/registry';
export {
  createCronSource,
  cronTickToInbound,
  CRON_SOURCE_ID,
} from './sources/cronSource';
export type { CronTick, CronTickFeed } from './sources/cronSource';
export {
  createFsSignalSource,
  fileSignalToInbound,
  FS_SOURCE_ID,
} from './sources/fsSignalSource';
export type { FileSignal, FsSignalSource } from './sources/fsSignalSource';
export {
  asThreadKey,
  computeTriggerId,
  toTrigger,
  SOURCE_EVENT_TYPES,
  THREAD_KEY_PREFIX,
} from './sources/types';
export type {
  EventSource,
  InboundEvent,
  SourceEventType,
  ThreadKey,
  Trigger,
} from './sources/types';

// 2026-09-24 R03-002 收敛：goal / swarm / selfwake 子目录统一出口
export {
  getTaskGoalStore,
  isTerminalGoalStatus,
  canTransitionGoal,
  TASK_GOALS_TABLE,
  TASK_GOAL_TERMINAL_STATUSES,
} from './goal/TaskGoalStore';
export type {
  TaskGoal,
  TaskGoalStatus,
  TaskGoalUpdateReason,
} from './goal/TaskGoalStore';
export { TaskGoalStore } from './goal/TaskGoalStore';
export {
  setGoalEventSink,
  emitGoalCreated,
  emitGoalUpdated,
  emitGoalStatusChanged,
  takeBatchGoalInstruction,
  takeIdleContinuationInstruction,
  takeMainSessionBudgetWrapUp,
} from './goal/GoalEvents';
export type { GoalEventAppender, GoalEventType } from './goal/GoalEvents';
export {
  isIdleContinuationTask,
  resolveIdleContinuation,
  enqueueIdleContinuation,
  IDLE_CONTINUE_TASK_PREFIX,
} from './goal/goalIdleContinuation';
export {
  settleGoalForRun,
  settleGoalForTurn,
  settleGoalById,
  ensureGoalForBatch,
} from './goal/goalRunBinding';
export type { GoalTurnReason } from './goal/goalRunBinding';
export {
  chargeGoalUsage,
  chargeSessionGoalUsage,
  injectMainSessionBudgetWrapUp,
} from './goal/goalBudget';
export { setSelfWakeResumeHandler } from './selfwake/SelfWakeService';
// T-⑥12（2026-10-03）：自唤醒续跑审计（`session/wake`）的唯一写入出口（注入式装配）
export {
  setSelfWakeAuditSink,
  hasSelfWakeAuditSink,
  recordSelfWake,
} from './selfwake/SelfWakeAudit';
export { getCg3SelfWakeService } from './Cg3Bootstrap';
export {
  SLEEP_FOR_TOOL,
  SLEEP_UNTIL_TOOL,
  createSelfWakeToolExecutors,
} from './selfwake/SelfWakeTools';
export { AgentSwarm, DEFAULT_SWARM_CONCURRENCY } from './swarm/AgentSwarm';
export type { SwarmExecutor, AgentSwarmResult } from './swarm/AgentSwarm';
