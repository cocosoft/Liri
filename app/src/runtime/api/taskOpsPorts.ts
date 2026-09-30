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
 * 任务运维 —— **服务层端口**（C1「口径 C」：`tasks` 域 **P1**；2026-09-30 台账 D-98）
 *
 * **范围（P1 = 4 文件 / 12 处）**：`agent1-handlers.ts` · `agent2-handlers.ts` ·
 * `kanban-handlers.ts`（任务状态存储的 `new` + `init` + 单次业务动作）·
 * `task-handlers.ts`（任务注册表单例）。
 * P2（`cron-handlers`）· P3（`plan-flow-handlers` + `pdca-handlers`）·
 * P4（`inbox` / `research` / `sessionWaitFields` / `goal-routes`）见 spec §3.12。
 * **四阶段共用同一端口**（规则 19：同域分阶段共用同一入口 `getTaskOpsPort()`，不新增入口）。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：
 * - 返回 app 对象处用 `unknown`；仅**调用方实际读字段**者给**最小投影 DTO**；
 * - 参数**照原调用点实参**定（规则 12）。
 *
 * ⚠️ **实例生命周期内聚实现侧**（规则 20）：原调用点均为「`new` + `init()` + 单次动作」，
 * 且**均未调用 `close()`** ⇒ 端口只暴露**一次业务动作**，并**保持不关闭**（与改动前行为逐字一致）。
 * 该「未关闭」本身是**预存问题**（每条请求新建 sqlite 连接不复用），已单独登记台账，**不在本批修复**。
 */

/**
 * 任务状态投影（P1；等价于 app 侧 `TaskState` 的**被消费面** ——
 * 调用方读取 `id` / `status` / `description` / `type` / `startTime` / `endTime` /
 * `toolUseCount` / `tokenCount` / `outputFile` / `error` / `metadata`）。
 */
export interface AgentTaskStateDto {
  id: string;
  /** app 侧为字符串字面量联合（原码直接与 `'completed'` / `'running'` 比较）⇒ 收宽为 `string` */
  status: string;
  description?: string | undefined;
  type?: string | undefined;
  startTime?: number | undefined;
  endTime?: number | undefined;
  toolUseCount?: number | undefined;
  tokenCount?: number | undefined;
  outputFile?: string | undefined;
  error?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** 任务句柄投影（P1；注册表元素的**被消费面** —— 调用方只读 `taskState`） */
export interface AgentTaskHandleDto {
  taskState: AgentTaskStateDto;
}

/** Cron 任务记录（P2；调用方需**原地修改**字段后回存 ⇒ 松散**可变**记录） */
export interface CronJobRecord {
  id?: string | undefined;
  name?: string | undefined;
  prompt?: string | undefined;
  enabled?: boolean | undefined;
  silent?: boolean | undefined;
  state?: string | undefined;
  lastRunAt?: string | undefined;
  nextRunAt?: string | undefined;
  /** 调度描述（原码**读/写** `schedule.expr`） */
  schedule?: Record<string, unknown> | undefined;
  /** 其余字段（`model` / `provider` / `scheduleDisplay` / `lastStatus` / …）由响应映射按需读取 ⇒ 透传 */
  [key: string]: unknown;
}

/** Cron 统计（P2；调用方只读 `total`） */
export interface CronStatsDto {
  total?: number | undefined;
  enabled?: number | undefined;
  paused?: number | undefined;
  failed?: number | undefined;
  completed?: number | undefined;
}

/**
 * Cron 任务存储句柄（P2）
 *
 * ⚠️ **调用方自持会话**（`init` → 多次操作 → `close`）—— 与 P1 的"单次动作"形态**不同**：
 * 原 `update` / `run` 站点是「读 → **原地改** → 回存」的**同一会话**，故此处给**句柄**而非原子方法。
 * 判据仍是"原调用点是否显式 `close()`"（对比规则 20：原调用点**不** close ⇒ 才内聚为原子方法）。
 */
export interface CronJobStorePort {
  init(): Promise<void>;
  loadJobs(): Promise<CronJobRecord[]>;
  /** 原 `getJob(cronId)`（app 侧返回 `undefined` ⇒ 端口归一为 `null`） */
  getJob(cronId: string): Promise<CronJobRecord | null>;
  upsertJob(job: CronJobRecord): Promise<void>;
  deleteJob(cronId: string): Promise<void>;
  getStats(): Promise<CronStatsDto>;
  /** 调用方只读各元素的 `state` */
  listEnabledJobs(): Promise<Array<{ state?: string | undefined }>>;
  close(): Promise<void>;
}

/** Cron 运行日志句柄（P2；同样**调用方自持会话**） */
export interface CronRunLogPort {
  init(): Promise<void>;
  queryPage(opts: {
    jobId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    status?: 'ok' | 'failed' | undefined;
  }): Promise<unknown>;
  close(): Promise<void>;
}

/** 计划步骤投影（P3；调用方读 `id` / `status` / `description` / `taskId` / `dependsOn`） */
export interface PlanStepDto {
  id: string;
  /** app 侧为字符串字面量联合（原码与 `'pending'` / `'running'` 比较）⇒ 收宽为 `string` */
  status: string;
  description?: string | undefined;
  taskId?: string | undefined;
  dependsOn?: string[] | undefined;
}

/** 计划投影（P3；调用方读 `id` / `steps`） */
export interface PlanDto {
  id: string;
  steps: PlanStepDto[];
}

/** PDCA 监控指标（P3-b；调用方读取全部 9 个数值字段） */
export interface PdcaMetricsDto {
  totalCycles: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  avgStepDurationMs: number;
  avgReviewScore: number;
  reviewPassRate: number;
  toolFailureSteps: number;
  abortRate: number;
}

/** PDCA 决策轨迹行（P3-b；调用方读取 `taskId` / `newStatus` / `detail` / `timestamp`） */
export interface PdcaDecisionRowDto {
  taskId: string;
  newStatus: string;
  /** `null` = 无明细 */
  detail: string | null;
  timestamp: number;
}

/**
 * PDCA 编排器句柄（P3-b）
 *
 * ⚠️ 生命周期由 app 侧**模块级注册表**持有（`activeOrchestrators`）⇒ 端口**不做**生命周期管理，
 * 只暴露**被消费面**（无需 `close`）。
 */
export interface PdcaOrchestratorPort {
  getStatus(): unknown;
  getMetrics(): PdcaMetricsDto;
  generateReport(): unknown;
  reviewStep(stepId: string): Promise<unknown>;
  decideStep(stepId: string, decision: string): Promise<void>;
  /**
   * ⚠️ **可选** —— app 侧编排器**无** `confirm` 方法（原码 `confirm?.()` 恒为 no-op）
   * ⇒ 端口保持**可选**，缺失即 no-op（行为不变）。
   */
  confirm?(decision?: unknown): Promise<void>;
  /** 原 `runFullPdca(description, sessionId)`（返回值原调用点仅用 `.catch()`） */
  runFullPdca(description: string, sessionId: string): Promise<unknown>;
  /**
   * 原 `resumeAfterApproval(sessionId)`。
   * ⚠️ `phase` **必填** —— 原调用点把 `result.phase` 直接喂给 `span.setAttribute`（需
   * `AttributeValue`）⇒ app 侧该字段为必填字符串（字符串枚举/联合均可赋给 `string`）。
   */
  resumeAfterApproval(sessionId: string): Promise<{ phase: string }>;
  /** 原 `abort()`（P4 `inbox-handlers` 审批撤销） */
  abort(): Promise<void>;
}

/**
 * PDCA 状态集（P3-b）
 * 原为桥接层的**模块级只读常量**（`ReadonlySet<string>`）⇒ 端口自持等价**只读集**，
 * 调用方**取一次、同步 `.has()`**（避免逐次 await）。
 */
export interface PdcaStatusSetsDto {
  terminal: ReadonlySet<string>;
  active: ReadonlySet<string>;
  awaitingApprovalPhases: ReadonlySet<string>;
}

/** 目标状态（P4；与 app 侧同构 —— 终态 = `completed` / `budget_limited` / `failed` / `cancelled`） */
export type TaskGoalStatusDto =
  | 'active'
  | 'blocked'
  | 'completed'
  | 'budget_limited'
  | 'failed'
  | 'cancelled';

/** 目标实体投影（P4；调用方读 `id` / `objective` / `status` / `sessionId` / `tokenBudget`） */
export interface TaskGoalDto {
  id: string;
  objective: string;
  status: TaskGoalStatusDto;
  sessionId?: string | undefined;
  tokenBudget?: number | undefined;
}

/** 自唤醒待触发条目投影（P4；调用方读 `kind` / `triggerAt` / `createdAt`） */
export interface WakeEntryDto {
  kind: string;
  triggerAt?: number | undefined;
  createdAt: number;
}

/** 任务运维端口（P1：12 方法；P2 追加 5；P3 追加 20；P4 追加 12 + 3 类型 —— **共 49 方法**） */
export interface TaskOpsPort {
  // ---- 任务状态存储（P1：`SqliteTaskStore`；`new` + `init()` 内聚实现侧）----
  /** 原 `new SqliteTaskStore()` + `init()` + `loadTaskStates()` */
  listTaskStates(): Promise<AgentTaskStateDto[]>;
  /** 原 `new SqliteTaskStore()` + `init()` + `getTaskState(taskId)`（`null` = 未找到） */
  getTaskState(taskId: string): Promise<AgentTaskStateDto | null>;
  /** 原 `new SqliteTaskStore()` + `init()` + `queryAuditLogs(taskId)` */
  queryTaskAuditLogs(taskId: string): Promise<unknown>;

  // ---- 看板卡片（P1：同一 `SqliteTaskStore`）----
  /** 原 `new SqliteTaskStore()` + `init()` + `loadKanbanCards()` */
  listKanbanCards(): Promise<unknown>;
  /** 原 `saveKanbanCard(card)`（新建 / 更新**同一入口**；参数照 app 侧签名） */
  saveKanbanCard(card: {
    id: string;
    title: string;
    description?: string | undefined;
    columnId?: string | undefined;
    assignee?: string | undefined;
    priority?: string | undefined;
    tags?: string[] | undefined;
    sortOrder?: number | undefined;
  }): Promise<void>;
  /** 原 `deleteKanbanCard(cardId)` */
  deleteKanbanCard(cardId: string): Promise<void>;
  /** 原 `updateKanbanCardColumn(cardId, columnId, sortOrder)` */
  moveKanbanCard(
    cardId: string,
    columnId: string,
    sortOrder: number
  ): Promise<void>;

  // ---- 任务注册表（P1：模块级**单例**，取用内聚实现侧 —— 规则 21）----
  /** 原 `taskRegistry.getAllTasks()`（调用方只读各元素的 `taskState`） */
  listAllTasks(): Promise<AgentTaskHandleDto[]>;
  /** 原 `taskRegistry.getTask(taskId)`（调用方**仅判真值** ⇒ `unknown`） */
  getRegisteredTask(taskId: string): Promise<unknown>;
  /** 原 `taskRegistry.kill(taskId)` */
  killTask(taskId: string): Promise<void>;
  /** 原 `taskRegistry.remove(taskId)` */
  removeTask(taskId: string): Promise<void>;
  /** 原 `taskRegistry.recoverLostTask(taskId)`（返回是否恢复成功） */
  recoverLostTask(taskId: string): Promise<boolean>;

  // ---- Cron（P2：`cron-handlers.ts`，11 处）----
  /**
   * 新建并返回 Cron 任务存储句柄（原 `new CronJobStore(resolveDbPath())`）。
   * ⚠️ `resolveDbPath()` **内聚实现侧**（实测 7 处**同参** ⇒ 可内聚，规则 12）。
   */
  createCronJobStore(): Promise<CronJobStorePort>;
  /** 新建并返回 Cron 运行日志句柄（原 `new CronRunLog(resolveDbPath())`） */
  createCronRunLog(): Promise<CronRunLogPort>;
  /** 唤醒全局调度器（原 `wakeGlobalCronScheduler()`；**调用方保留 try/catch** 以容忍"未启动"） */
  wakeCronScheduler(): Promise<void>;
  /**
   * 调度器状态（原 `isGlobalCronSchedulerStarted() && getGlobalCronScheduler()` 后取 `getStatus()`）；
   * `null` = 未启动 ⇒ 调用方走**静态回退**分支。
   */
  getCronSchedulerStatus(): Promise<unknown | null>;
  /** 计算下次运行时间（原 `computeNextCronRun(expr, nowMs)`；`null` = 无法计算） */
  computeNextCronRun(expr: string, nowMs: number): Promise<string | null>;

  // ---- 任务编排 / 计划（P3：`plan-flow-handlers.ts`；单例取用内聚 —— 规则 21）----
  /** 原 `taskOrchestrator['initialize']()` */
  initTaskOrchestrator(): Promise<void>;
  /** 原 `taskOrchestrator.getPlansByWorkspace(workspaceId)` */
  getPlansByWorkspace(workspaceId: string): Promise<PlanDto[]>;
  /** 原 `taskOrchestrator.getAllPlans()` */
  getAllPlans(): Promise<PlanDto[]>;
  /**
   * 原 `createPlan(description, steps, sessionId, undefined, undefined, workspaceId)`
   * —— 原调用点第 4/5 参**恒为 `undefined`** ⇒ 端口不收（规则 12：照原实参）。
   */
  createPlan(params: {
    description: string;
    stepDescriptions: string[];
    sessionId: string;
    workspaceId?: string | undefined;
  }): Promise<PlanDto>;
  /** 原 `taskOrchestrator.getPlan(planId)`（app 侧返回 `undefined` ⇒ 端口归一为 `null`） */
  getPlan(planId: string): Promise<PlanDto | null>;
  /** 原 `taskOrchestrator.getPlanProgress(planId)`（调用方仅 `JSON.stringify`） */
  getPlanProgress(planId: string): Promise<unknown>;
  /** 原 `taskOrchestrator.markStepRunning(stepId)`（返回值原调用点未使用） */
  markStepRunning(stepId: string): Promise<void>;
  /** 原 `taskOrchestrator.markStepFailed(stepId, reason)`（返回值原调用点未使用） */
  markStepFailed(stepId: string, reason?: string | undefined): Promise<void>;

  // ---- 任务流注册表（P3：模块级**单例**，取用内聚 —— 规则 21）----
  /** 原 `taskFlowRegistry.getAllFlows()`（调用方仅 `JSON.stringify`） */
  listTaskFlows(): Promise<unknown>;
  /** 原 `taskFlowRegistry.getFlow(flowId)`（调用方**仅判真值** ⇒ `unknown`） */
  getTaskFlow(flowId: string): Promise<unknown>;
  /** 原 `taskFlowRegistry.getStats()`（调用方仅 `JSON.stringify`） */
  getTaskFlowStats(): Promise<unknown>;

  // ---- PDCA（P3-b：`pdca-handlers.ts`）----
  /**
   * 原 `new SqliteTaskStore()` + `listAuditLogByEvent('pdca_decision', limit)`。
   * ⚠️ 原调用点**既不 `init()` 也不 `close()`**（方法内部自 `ensureDb`）⇒ 端口**逐字保持**。
   */
  listPdcaDecisionRows(limit: number): Promise<PdcaDecisionRowDto[]>;
  /** 原 `readPdcaCheckpoint(taskId)`（`null` = 无检查点） */
  readPdcaCheckpoint(taskId: string): Promise<Record<string, unknown> | null>;
  /** 原 `writePdcaCheckpoint(taskId, patch)`（app 侧为**同步**函数 ⇒ 端口包一层 Promise） */
  writePdcaCheckpoint(
    taskId: string,
    patch: Record<string, unknown>
  ): Promise<void>;
  /** 原 `syncPdcaWorkItemStatus(taskId, phase)`（app 侧为**同步**函数） */
  syncPdcaWorkItemStatus(taskId: string, phase: string): Promise<void>;
  /** 原 `getPdcaCheckpointIndex()`（带记忆索引；`Map<taskId, checkpoint>`） */
  getPdcaCheckpointIndex(): Promise<Map<string, Record<string, unknown>>>;
  /** 原三个模块级只读状态集（终态 / 活跃 / 待审批阶段） */
  getPdcaStatusSets(): Promise<PdcaStatusSetsDto>;
  /** 原 `getOrchestrator(taskId)`（app 侧返回 `undefined` ⇒ 端口归一为 `null`） */
  getPdcaOrchestrator(taskId: string): Promise<PdcaOrchestratorPort | null>;
  /** 原 `getOrCreateOrchestrator(taskId)`（不存在则创建） */
  getOrCreatePdcaOrchestrator(taskId: string): Promise<PdcaOrchestratorPort>;
  /** 原 `getAllOrchestrators()` */
  listPdcaOrchestrators(): Promise<PdcaOrchestratorPort[]>;

  // ---- 自唤醒 / pitfall / PDCA 直播 / 目标（P4）----
  /**
   * 原 `getCg3SelfWakeService()` 后 `getPendingBySession(sessionId)`。
   * `null` = CG3 **未启动**（原码 `if (!selfWake) return undefined`）；`[]` = 无待触发。
   */
  listPendingWakes(sessionId: string): Promise<WakeEntryDto[] | null>;
  /**
   * 原 `pitfallRegistry.record(input)`。
   * ⚠️ app 侧为**同步**函数（返回 `PitfallEntry`；原调用点未使用其返回值）⇒ 端口包一层 Promise。
   */
  recordPitfall(input: {
    description: string;
    error: string;
    source: 'verifier';
    contextSig?: string | undefined;
  }): Promise<void>;
  /**
   * 原 `emitPdcaLiveEvent(type, { sessionId, taskId }, data)`（研究模式复用 PDCA 直播通道；
   * 原调用点已 `void` 不 await ⇒ 端口异步化**无时序变更**）。
   */
  emitPdcaLiveEvent(
    type: 'pdca:stage:phase' | 'pdca:stage:complete' | 'pdca:stage:fail',
    core: { sessionId?: string | undefined; taskId?: string | undefined },
    data: Record<string, unknown>
  ): Promise<void>;

  // ---- 目标（P4：`routes/goal-routes.ts`；模块级单例取用内聚 —— 规则 21）----
  /** 原 `getTaskGoalStore().get(id)`（`null` = 不存在） */
  getTaskGoal(id: string): Promise<TaskGoalDto | null>;
  /** 原 `store.create({ objective, sessionId, tokenBudget, id })` */
  createTaskGoal(params: {
    objective: string;
    sessionId?: string | undefined;
    tokenBudget?: number | undefined;
    id?: string | undefined;
  }): Promise<TaskGoalDto>;
  /** 原 `store.listActive(sessionId)` */
  listActiveTaskGoals(sessionId?: string | undefined): Promise<TaskGoalDto[]>;
  /** 原 `store.listBySession(sessionId)` */
  listTaskGoalsBySession(sessionId: string): Promise<TaskGoalDto[]>;
  /**
   * 原 `store.updateFields(id, changes, reason)`（`null` = 目标不存在 / 已是终态）。
   * ⚠️ `reason` 原为**原因码联合**（无端口侧静态类型可依）⇒ 实现侧一处边界收窄。
   */
  updateTaskGoalFields(
    id: string,
    changes: {
      objective?: string | undefined;
      tokenBudget?: number | undefined;
    },
    reason?: string | undefined
  ): Promise<TaskGoalDto | null>;
  /** 原 `isTerminalGoalStatus(status)`（app 侧为**同步**函数） */
  isTerminalGoalStatus(status: TaskGoalStatusDto): Promise<boolean>;
  /** 原 `emitGoalCreated({ goalId, objective, sessionId, tokenBudget })` */
  emitGoalCreated(params: {
    goalId: string;
    objective: string;
    sessionId?: string | undefined;
    tokenBudget?: number | undefined;
  }): Promise<void>;
  /** 原 `emitGoalUpdated({ sessionId, goalId, changes, reason })` */
  emitGoalUpdated(params: {
    sessionId?: string | undefined;
    goalId: string;
    changes: {
      objective?: string | undefined;
      tokenBudget?: number | undefined;
      runId?: string | undefined;
    };
    reason: string;
  }): Promise<void>;
}
