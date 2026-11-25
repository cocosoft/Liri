/**
 * 状态机**定义目录**（State Machine Catalog）—— 状态机规范管理方案 阶段 1（2026-10-12）。
 *
 * ⚠️ **与 `StateMachineRegistry` 的分工（方案订正）**：`StateMachineRegistry` 是**运行时实例**
 * 注册表（按 id 存实例 / `gc` / `find`），**不是**定义目录 ⇒ 方案 v1.0 中「把状态机接入
 * `StateMachineRegistry`」的表述属**类别错误**，已订正为「登记到**本目录**」。
 *
 * 本模块 = **只读、无副作用、零语义变更**的**定义级清单**（「全仓有哪些状态机 / 各自状态 / 谁拥有」），
 * 用于满足验收①**可枚举**。
 *
 * 依赖约束：本文件**不导入任何域模块**（避免 `core←service` 倒挂）；与源码枚举的**一致性**由
 * `tests/state/stateMachineCatalog.test.ts` 动态载入断言（防目录漂移）。
 *
 * **取证口径 `verification`**（阶段 1.3 回仓取证）：
 * - `runtime-import`：源码**导出可运行时载入**的锚点（`as const` 数组 / `export enum`）⇒ 测试**逐项比对**；
 * - `source-read`：源码只有 **TS 类型联合**或**内联字面量**（无运行时锚点）⇒ 取值经**逐行阅读**取证，
 *   测试仅断言条目存在（**如实标注，不谎称有机器校验**）。
 */

/** 语义类别：持久化态 / 瞬态（工具执行中的人在环）/ 投影（只读广播） */
export type StateMachineKind = 'persistent' | 'transient' | 'projection';

/** 取值取证方式（见文件头说明） */
export type StateMachineVerification = 'runtime-import' | 'source-read';

/** 运行时锚点（供测试动态载入比对；`kind==='runtime-import'` 时必填） */
export interface StateMachineVerifyRef {
  /** 仓库相对路径（ts 源码文件） */
  module: string;
  /** 导出名（`as const` 数组名，或 `enum` 名） */
  exportName: string;
  /** 锚点形态：数组直接比对；enum 取 `Object.values` 比对；objectKeys 取 `Object.keys` 比对（转移规则表） */
  anchor: 'array' | 'enum' | 'objectKeys';
}

/** 定义目录条目 */
export interface StateMachineEntry {
  /** 目录内唯一标识 */
  id: string;
  /** 人读名称 */
  title: string;
  /** 语义类别 */
  kind: StateMachineKind;
  /** 事实源文件（**已回仓取证**） */
  sourceFile: string;
  /** 状态取值（**逐项与源码核对**） */
  states: readonly string[];
  /** 取值取证方式 */
  verification: StateMachineVerification;
  /** 运行时锚点（可选；见 `verification`） */
  verifyRef?: StateMachineVerifyRef;
  /** 是否有集中的转移函数（单一转移事实源） */
  hasTransitionFn: boolean;
  /**
   * 责任域（**模块名**，不写个人）。2026-11-24 治理方案 R09-007 起必填。
   */
  owner: string;
  /**
   * 状态落盘方式（治理方案 R09-007 起必填）：
   * `memory` = 进程内，不跨重启；`json-file` / `sqlite` = 持久化。
   */
  persistence: 'none' | 'memory' | 'json-file' | 'sqlite';
  /**
   * 转移规则表锚点（可选）。有导出规则表的机器必须给出 —— R09-008 会载入并校验
   * 「键集合 = `states`、目标 ⊆ `states`」。手写机（转移集中在 CAS/UPDATE 函数里）可缺省，
   * 但须在 note 写明集中实现位置。
   */
  transitionRules?: { module: string; exportName: string };
  /**
   * 终态集合（治理方案 R09-007 起必填）：进入后不应再转移；无终态写 `[]`。
   */
  terminalStates: readonly string[];
  /**
   * 重启对账策略（`persistence !== 'none'` 时必填，R09-009）：
   * `none` 仅用于无恢复动作的机器（须在 note 说明理由）。
   */
  reconcile?: {
    strategy:
      | 'none'
      | 'ttl-sweep'
      | 'startup-reset'
      | 'startup-rescan'
      | 'cas-requeue'
      | 'heartbeat-rescan';
    /** 证据锚点：`文件#函数/类` */
    evidence: string;
  };
  /** 消费该状态的派生实现（可选；治理方案 R09-011 的目标登记面） */
  derivedViews?: readonly string[];
  /**
   * 转移审计声明（治理方案 R09-013 / P2-1，`persistence !== 'none'` 时必填）：
   * - `session-event`：每次转移落结构化会话事件（`event` 为事件名；`state/transition` 为通用审计）；
   * - `exempt`：**不落**会话事件，必须写明理由（无会话维度 / 已有本地审计 / 无真实写点等）。
   */
  audit?:
    | {
        mode: 'session-event';
        event: string;
        /** 发射点证据：`文件#符号`（R09-013 门禁校验文件存在且符号出现） */
        evidence?: string;
        note?: string;
      }
    | { mode: 'exempt'; reason: string };
  /** 前端对应实现（可选；治理方案 R09-012 的跨端对齐面） */
  crossEnd?: { clientFile: string; mapping: 'identical' | 'projection' };
  /** 补充说明（同名不同物 / 双事实源等） */
  note?: string;
}

/**
 * **已取证登记**（阶段 1.3 完成；2026-11-24 治理方案 P0-1 扩为 **16 台**：
 * 补齐 `stream` / `backgroundTask` 两台已接入引擎、此前只在豁免清单的机器，并为全部条目
 * 增加 `owner` / `persistence` / `terminalStates` / `reconcile` 等治理字段）。
 */
export const STATE_MACHINES: readonly StateMachineEntry[] = [
  {
    id: 'execution',
    title: '执行状态机（Execution）',
    kind: 'persistent',
    sourceFile: 'packages/service/src/execution/types.ts',
    states: [
      'QUEUED',
      'RUNNING',
      'WAITING_USER',
      'CANCEL_REQUESTED',
      'CANCELLED',
      'COMPLETED',
      'FAILED',
      'STALE',
    ],
    verification: 'runtime-import',
    verifyRef: {
      module: 'packages/service/src/execution/types.ts',
      exportName: 'EXECUTION_STATUSES',
      anchor: 'array',
    },
    hasTransitionFn: true,
    owner: 'execution',
    persistence: 'sqlite',
    transitionRules: {
      module: 'packages/service/src/execution/types.ts',
      exportName: 'EXECUTION_TRANSITIONS',
    },
    terminalStates: ['CANCELLED', 'COMPLETED', 'FAILED', 'STALE'],
    reconcile: {
      strategy: 'heartbeat-rescan',
      evidence: 'packages/service/src/execution/ExecutionManager.ts#recover',
    },
    audit: {
      mode: 'session-event',
      event: 'execution/status_changed',
      evidence: 'packages/service/src/execution/ExecutionManager.ts#emitStatus',
    },
    derivedViews: [
      'packages/service/src/execution/executionProjection.ts#projectExecutionStatus',
    ],
  },
  {
    id: 'toolCall',
    title: '工具调用状态机（ToolCall）',
    kind: 'persistent',
    sourceFile: 'packages/service/src/execution/types.ts',
    states: ['running', 'completed', 'failed', 'unknown'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'packages/service/src/execution/types.ts',
      exportName: 'TOOL_CALL_STATUSES',
      anchor: 'array',
    },
    hasTransitionFn: true,
    owner: 'execution',
    persistence: 'sqlite',
    terminalStates: ['completed', 'failed', 'unknown'],
    reconcile: {
      strategy: 'heartbeat-rescan',
      evidence: 'packages/service/src/execution/ExecutionManager.ts#recover',
    },
    audit: {
      mode: 'session-event',
      event: 'state/transition',
      evidence: 'packages/service/src/execution/ExecutionManager.ts#auditToolCall',
    },
    crossEnd: {
      clientFile: 'client/src/stores/chat/toolOutcome.ts',
      mapping: 'projection',
    },
    note: '转移集中在 `ExecutionStore.settleToolCall` / `ExecutionManager.recover`（手写机，无规则表）—— 恢复期把副作用不可知的调用结算为 `unknown`（P0-4）。',
  },
  {
    id: 'budgetMode',
    title: '预算档位（BudgetMode）',
    kind: 'persistent',
    sourceFile: 'packages/query/src/query/dailyBudgetSnapshot.ts',
    states: ['normal', 'report_only', 'locked'],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'query',
    persistence: 'json-file',
    terminalStates: [],
    reconcile: {
      strategy: 'startup-reset',
      evidence: 'packages/query/src/query/DailyBudgetManager.ts#restore',
    },
    audit: {
      mode: 'exempt',
      reason:
        '模式按当日用量**读时计算**（`_computeState`），不落盘、无独立写点；全局单机无会话维度，已有日志 + `alert:triggered` 告警出口。',
    },
    note: '**已于 2026-10-12 去重（阶段 1.3 隐患修复）**：单一事实源 = `dailyBudgetSnapshot.ts:31`（`export type`）；`DailyBudgetManager.ts` 已改为 `import type`（不再本地重声明）；前端镜像 `client/src/services/usageService.ts:113` 改名 `DailyBudgetMode`。',
  },
  {
    id: 'dedupProcess',
    title: 'dedup 消息处理态（MessageProcessingState）',
    kind: 'persistent',
    sourceFile: 'packages/channels/src/channels/dedup/types.ts',
    states: ['RECEIVED', 'ADMITTED', 'REJECTED'],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'channels',
    persistence: 'sqlite',
    terminalStates: ['ADMITTED', 'REJECTED'],
    reconcile: {
      strategy: 'ttl-sweep',
      evidence: 'packages/channels/src/channels/dedup/index.ts#configureDedup',
    },
    audit: {
      mode: 'exempt',
      reason:
        '去重发生在**会话创建之前**（键 `channelId:senderId:messageId`），无 sessionId 可挂；残留由 TTL sweep 回收。',
    },
    note: '有导出数组 `MESSAGE_PROCESSING_STATES`（现定义于 `channels/dedup/types.ts`，由 `index.ts` 重导出），但该模块同时构建 DedupStore（导入即触 DB）⇒ **不在测试中动态载入**，取值经源码阅读取证。',
  },
  {
    id: 'goal',
    title: '任务目标状态（TaskGoalStatus）',
    kind: 'persistent',
    sourceFile: 'shared/types/goal-types.ts',
    states: [
      'active',
      'blocked',
      'completed',
      'budget_limited',
      'failed',
      'cancelled',
    ],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'tasks',
    persistence: 'sqlite',
    terminalStates: ['completed', 'budget_limited', 'failed', 'cancelled'],
    reconcile: {
      strategy: 'startup-rescan',
      evidence:
        'app/src/tasks/goal/goalStartupResume.ts#resolveStartupGoalResume',
    },
    audit: {
      mode: 'session-event',
      event: 'goal/status_changed',
      evidence: 'app/src/tasks/goal/GoalEvents.ts#emitGoalStatusChanged',
    },
    note: '定义在 `shared/types`（`:26`），经 `app/src/types/goal.ts:17` 再导出；同目录另有**同名不同物** `goalSettlementTypes.ts:22`（批次落定结果，见 `BOUNDARY_STATE_MACHINES`）。',
  },
  {
    id: 'workflowStopReason',
    title: 'Workflow 停止原因（WorkflowStopReason）',
    kind: 'persistent',
    sourceFile: 'app/src/modules/workflow/types.ts',
    states: ['completed', 'cancelled', 'error'],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'workflow',
    persistence: 'memory',
    terminalStates: ['completed', 'cancelled', 'error'],
    reconcile: {
      strategy: 'none',
      evidence: 'app/src/modules/workflow/types.ts#WorkflowRunResult',
    },
    audit: {
      mode: 'session-event',
      event: 'assistant/workflow_run_end',
      evidence: 'app/src/modules/workflow/WorkflowRunEvents.ts#toRunEnd',
      note: 'run 结束事件的载荷已含 `stopReason`（`WorkflowRunEvents.ts`）。',
    },
    note: '同文件另有步骤级 `WorkflowStepOutcome`（`:144`，3 值不同）—— 属不同粒度，未合并。',
  },
  {
    id: 'appState',
    title: '应用状态（AppState 4 态）',
    kind: 'persistent',
    sourceFile: 'packages/infra/src/state/app/types.ts',
    states: ['idle', 'busy', 'paused', 'error'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'packages/infra/src/state/app/types.ts',
      exportName: 'AppState',
      anchor: 'enum',
    },
    hasTransitionFn: true,
    owner: 'app-state',
    persistence: 'json-file',
    terminalStates: [],
    reconcile: {
      strategy: 'startup-reset',
      evidence:
        'packages/infra/src/state/app/AppLifecycle.ts#restoreFromSnapshot',
    },
    audit: {
      mode: 'exempt',
      reason:
        '全局单机状态（MACHINE_ID=`app`），无会话维度；转移已由 SSE `app:state` 广播 + 快照落盘（`persistSnapshot`）。',
    },
    note: '**同名不同物**：`app/src/appState/AppState.ts:145` 另有 `interface AppState`（zustand 存储接口），勿混。',
  },
  {
    id: 'appInstall',
    title: '应用安装状态（marketplace / plugin）',
    kind: 'persistent',
    sourceFile: 'app/src/appState/AppState.ts',
    states: ['pending', 'installing', 'installed', 'failed'],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'app-state',
    persistence: 'memory',
    terminalStates: ['installed', 'failed'],
    reconcile: {
      strategy: 'none',
      evidence: 'app/src/appState/AppState.ts#AppInstallStatus',
    },
    audit: {
      mode: 'exempt',
      reason:
        '无生产写入点（仅类型 + zustand 默认值），不存在可审计的转移实现。',
    },
    note: '**已于 2026-10-12 抽为命名类型（阶段 1.3 隐患修复）**：`export type AppInstallStatus`（`AppState.ts`），原 `:253`/`:259` 两处内联重复已消除。',
  },
  {
    id: 'sessionState',
    title: '会话状态机（SessionState **3 态**）',
    kind: 'persistent',
    sourceFile: 'packages/infra/src/state/session/types.ts',
    states: ['idle', 'running', 'requires_action'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'packages/infra/src/state/session/types.ts',
      // 3 态为**类型联合**（无 enum）⇒ 运行时锚点取转移规则表的**键**（`anchor: 'objectKeys'`）
      exportName: 'SESSION_TRANSITIONS',
      anchor: 'objectKeys',
    },
    hasTransitionFn: true,
    owner: 'session',
    persistence: 'memory',
    transitionRules: {
      module: 'packages/infra/src/state/session/types.ts',
      exportName: 'SESSION_TRANSITIONS',
    },
    terminalStates: [],
    reconcile: {
      strategy: 'startup-reset',
      // 2026-11-24（P2）：原指向 `SessionStateBridge`（无事件发布方的死轨）⇒ 改为**真实**持有
      // 机器实例的唯一处（`ChatManager` 经 `SessionRuntimeState` 取/建）。
      evidence: 'app/src/chat/manager/sessionRuntimeState.ts#SessionRuntimeState',
    },
    audit: {
      mode: 'session-event',
      event: 'state/transition',
      evidence:
        'packages/infra/src/state/session/SessionStateMachine.ts#SessionStateMachine',
    },
    note: '**阶段 3（2026-10-12）8 态 → 3 态收敛（用户裁定）**：旧 `SessionState` 8 态枚举与 `toSimplifiedState()` 已删除（前者零消费者、后者失输入类型）；折叠映射 = `IDLE/COMPLETED/ARCHIVED/ABORTED→idle`、`RUNNING→running`、`REQUIRES_ACTION/PAUSED/ERROR→requires_action`。**无终态**（`idle` 可再 `start()` ⇒ 生命周期成环，`isTerminal()` 恒 `false`）。历史事实源（活）：`ChatManager`（`SessionRuntimeState` 取/建机器）· `ChatOrchestrator.sendMessage`（`start/finish`）· `streamMessagePrepare`（流式 `start`）· `streamFinalize`（`pause/finish`）。2026-11-24：原 `SessionStateBridge` 按 CD01–CD06 摘除（其订阅的生命周期事件全仓无发布方，实例从不被读取）。`packages/service/src/session/models/SessionState.ts:44` 另有**同名不同物**（类 + `SESSION_STATES` 集合），见 `BOUNDARY_STATE_MACHINES`。',
  },
  {
    id: 'task',
    title: '任务状态机（TaskStatus 7 态）',
    kind: 'persistent',
    sourceFile: 'packages/kernel/src/core/taskStatus.ts',
    states: [
      'pending',
      'running',
      'blocked',
      'completed',
      'failed',
      'killed',
      'lost',
    ],
    verification: 'runtime-import',
    verifyRef: {
      module: 'packages/kernel/src/core/taskStatus.ts',
      exportName: 'TaskStatus',
      anchor: 'enum',
    },
    hasTransitionFn: true,
    owner: 'tasks',
    persistence: 'sqlite',
    transitionRules: {
      module: 'packages/infra/src/state/task/TaskStateMachine.ts',
      exportName: 'TASK_TRANSITIONS',
    },
    terminalStates: ['completed', 'failed', 'killed', 'lost'],
    reconcile: {
      strategy: 'startup-reset',
      evidence: 'app/src/tasks/TaskRegistry.ts#recoverRunningTasksAfterRestart',
    },
    audit: {
      mode: 'exempt',
      reason:
        '`TaskState` 无 sessionId（仅可选 `metadata.sessionKey`，生产未写入）；转移已落 TaskRegistry 本地审计（`task_audit` 表 + `audit.jsonl`，含 from/to/reason）。',
    },
    note: '**同名不同物**：`app/src/components/TaskListV2.tsx:9` 另有 6 态 UI 词汇表（含 `ALL_TASK_STATUSES`），见 `BOUNDARY_STATE_MACHINES`。',
  },
  {
    id: 'toolExecutionTransient',
    title: '工具执行瞬态（requires_approval / awaiting_approval）',
    kind: 'transient',
    sourceFile: 'packages/infra/src/utils/toolContract/ToolResult.ts',
    states: ['requires_approval', 'awaiting_approval'],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'execution',
    persistence: 'memory',
    terminalStates: [],
    reconcile: {
      strategy: 'none',
      evidence:
        'packages/infra/src/utils/toolContract/ToolResult.ts#ToolExecutionStatus',
    },
    audit: {
      mode: 'session-event',
      event: 'state/transition',
      evidence:
        'app/src/chat/services/toolApprovalOutcome.ts#resolveToolApprovalOutcome',
    },
    note: '按方案阶段 2.3 裁断：**工具执行瞬态**，**不进** `ToolCallStatus` 持久化枚举。**已于 2026-10-12 消除裸字面量（阶段 1.3 隐患修复）**：`awaiting_approval` 唯一事实源 = `ToolExecutionService.ts` 的 `TRANSIENT_AWAITING_APPROVAL` 常量（原 2 处裸字面量已替换）；`requires_approval` 唯一事实源 = `ToolExecutionStatus.REQUIRES_APPROVAL`（`ToolResult.ts:12`，原比较处的裸字符串已替换）。',
  },
  {
    id: 'stepVerdict',
    title: 'PDCA 步骤结论标记（StepVerdict 4 值）',
    kind: 'persistent',
    sourceFile: 'app/src/tasks/stepVerdict.ts',
    states: ['step_done', 'step_blocked', 'step_partial', 'step_unverified'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'app/src/tasks/stepVerdict.ts',
      exportName: 'STEP_VERDICTS',
      anchor: 'array',
    },
    hasTransitionFn: false,
    owner: 'tasks',
    // 无独立状态存储：verdict 是步骤产出的解析标记，随计划落盘；无恢复动作 ⇒ none
    persistence: 'none',
    terminalStates: [
      'step_done',
      'step_blocked',
      'step_partial',
      'step_unverified',
    ],
    note: '2026-11-02 新增：编排步骤的**目标达成判定**（与 `PlanStep.status` 正交 —— 前者是"目标是否达成"，后者是"执行到哪一步"）。来源是步骤产出末行的结构化标记，**不对自然语言做关键词匹配**（CS02）。`step_unverified` = 未提供标记，既有计划沿用 completed 口径但**不计入"执行完成"播报**。取值带 `step_` 前缀：`done/blocked/partial` 是跨域通用词，直接登记会把 dream/sandbox/compaction 等既有出现点一并划入词汇表。',
  },
  {
    id: 'selfWake',
    title: '自唤醒状态机（SelfWake）',
    kind: 'persistent',
    sourceFile: 'app/src/tasks/selfwake/types.ts',
    states: ['pending', 'due', 'firing', 'fired', 'failed', 'expired'],
    verification: 'source-read',
    hasTransitionFn: true,
    owner: 'tasks',
    persistence: 'json-file',
    terminalStates: ['fired', 'failed', 'expired'],
    reconcile: {
      strategy: 'startup-rescan',
      evidence:
        'app/src/tasks/selfwake/SelfWakeService.ts#recoverOverdueWakes',
    },
    audit: {
      mode: 'session-event',
      event: 'state/transition',
      evidence: 'app/src/tasks/selfwake/WakeStore.ts#updateEntry',
    },
    note: '2026-11-24（批次 2 / A3）登记：转移实现集中在 `WakeStore`（`tryMarkFiring` / `requeueAfterFailure` / `expireStale` / `recoverStaleFiring`）。`pending|due` = 待触发（`pendingWake` 投影只认这两态）；`firing` = 单进程 CAS 中间态（防 tick 重扫与短时 timer 双续跑，崩溃后启动期复位）；`fired|failed|expired` = 终态（`gc` 按 `firedAt/failedAt/expiredAt` 裁剪）。',
  },
  {
    id: 'effectQueue',
    title: '统一 effects 队列条目状态（4 值）',
    kind: 'persistent',
    sourceFile: 'app/src/tasks/effects/types.ts',
    states: [
      'effect_pending',
      'effect_attempting',
      'effect_settled',
      'effect_failed',
    ],
    verification: 'runtime-import',
    verifyRef: {
      module: 'app/src/tasks/effects/types.ts',
      exportName: 'EFFECT_STATUSES',
      anchor: 'array',
    },
    hasTransitionFn: false,
    owner: 'tasks',
    persistence: 'sqlite',
    terminalStates: ['effect_settled', 'effect_failed'],
    reconcile: {
      strategy: 'ttl-sweep',
      evidence: 'app/src/tasks/effects/EffectQueue.ts#claimOne',
    },
    audit: {
      mode: 'exempt',
      reason:
        '队列表**无 session 列**（`payload` 仅可选 `channelSessionId`，非一等维度）；转移由陈旧窗口重领（`claimOne`）恢复，属队列机械态而非业务状态。',
    },
    note: 'P38（2026-11-02）：`effect_pending → effect_attempting → effect_settled | effect_failed`。`effect_attempting` 只在原子领取后出现（崩溃后由陈旧窗口重领，`restored=1` 标记"可能已发出"）；`later` **不是状态**（只前移 due，回 pending）；连续失败达每类上限（`reply` 8，其余 `FAILURES_BEFORE_ERROR`=3）才进入 failed。取值带 `effect_` 前缀：`pending/settled/failed` 是跨域通用词，直接登记会把 chat/query/utils 既有 `settled` 出现点一并划入词汇表（与 P33 的 `step_` 同款教训）。',
  },
  {
    id: 'inboxApproval',
    title: '收件箱审批状态机（InboxItemStatus）',
    kind: 'persistent',
    sourceFile: 'packages/service/src/runtime/InboxManager.ts',
    states: ['pending', 'processing', 'replied', 'expired', 'dismissed'],
    verification: 'source-read',
    hasTransitionFn: true,
    owner: 'inbox',
    persistence: 'sqlite',
    terminalStates: ['replied', 'expired', 'dismissed'],
    reconcile: {
      strategy: 'startup-rescan',
      evidence:
        'packages/service/src/runtime/inboxApproval.ts#reconcileStuckApprovalSessions',
    },
    audit: {
      mode: 'session-event',
      event: 'state/transition',
      evidence:
        'packages/service/src/runtime/inbox/stateAudit.ts#auditInboxStatusChange',
    },
    note: '2026-11-24（P0-2 补登记，P0-1 遗漏）：`pending → processing`（CAS 抢锁）→ `replied | expired | dismissed`；`processing` 超时 10min 由过期扫描回收，落地失败回滚 `pending`（批次 1 / A1）。状态用**单数常量**（`INBOX_STATUS_*`）而非 `*_STATUSES` 数组 ⇒ 不被 R09-006 捕获，属"只漏报"盲区。',
  },
  {
    id: 'plan',
    title: '计划生命周期（Plan.status）',
    kind: 'persistent',
    sourceFile: 'app/src/tasks/TaskOrchestrator.ts',
    states: ['pending', 'running', 'completed', 'failed', 'aborted'],
    verification: 'source-read',
    hasTransitionFn: false,
    owner: 'tasks',
    persistence: 'sqlite',
    terminalStates: ['completed', 'failed', 'aborted'],
    reconcile: {
      strategy: 'startup-rescan',
      evidence:
        'app/src/tasks/plan/planStartupResume.ts#resolveStartupPlanResume',
    },
    audit: {
      mode: 'session-event',
      event: 'state/transition',
      evidence: 'app/src/tasks/plan/planStatusAudit.ts#auditPlanStatusChange',
    },
    note: '2026-11-24（P0-2 补登记）：`status` 为类型联合（`TaskOrchestrator.ts:163`），另有两个**正交子态**：`paused`（`running` 的等待审批子态，布尔）与 `acceptance`（`pending/accepted/rejected`，见 `pending-acceptance-state-machine.md`）—— 均不并入本状态集，避免词义混叠。',
  },
  {
    id: 'stream',
    title: '流生命周期状态机（StreamState）',
    kind: 'persistent',
    sourceFile: 'packages/service/src/streaming/types.ts',
    states: ['idle', 'streaming', 'paused', 'completed', 'error', 'cancelled'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'packages/service/src/streaming/types.ts',
      exportName: 'StreamState',
      anchor: 'enum',
    },
    hasTransitionFn: true,
    owner: 'streaming',
    persistence: 'memory',
    transitionRules: {
      module: 'packages/service/src/streaming/StreamStateMachine.ts',
      exportName: 'STREAM_TRANSITIONS',
    },
    terminalStates: ['completed', 'error', 'cancelled'],
    reconcile: {
      strategy: 'none',
      evidence: 'packages/service/src/streaming/Stream.ts#Stream',
    },
    audit: {
      mode: 'exempt',
      reason:
        '`Stream` 实例不持有 sessionId（service 流式管道，宿主按 streamId 关联）；转移经引擎 `onStateChange` 可订阅，宿主侧已有流式事件兜底。',
    },
    note: '2026-11-24（P0-1）从豁免升级为登记：引擎实例由 `Stream` 创建（`Stream.ts:59,247`），进程内状态、不跨重启 ⇒ 无启动对账。**已知漂移**：`types.ts:282-293` 的 `StreamStateTransition` 类型联合缺 `ERROR→STREAMING`，而规则表允许 —— 由 R09-008（P0-2）校验规则表自洽并推动对齐。',
  },
  {
    id: 'backgroundTask',
    title: '后台任务状态机（BackgroundTaskState）',
    kind: 'persistent',
    sourceFile:
      'packages/infra/src/state/background/BackgroundTaskStateMachine.ts',
    states: ['idle', 'running', 'skipped', 'completed', 'failed'],
    verification: 'runtime-import',
    verifyRef: {
      module:
        'packages/infra/src/state/background/BackgroundTaskStateMachine.ts',
      exportName: 'BackgroundTaskState',
      anchor: 'enum',
    },
    hasTransitionFn: true,
    owner: 'background-tasks',
    persistence: 'memory',
    transitionRules: {
      module:
        'packages/infra/src/state/background/BackgroundTaskStateMachine.ts',
      exportName: 'BACKGROUND_TASK_TRANSITIONS',
    },
    // 规则表允许 completed/failed 再回 running/idle（下一轮）⇒ 出度非 0，按引擎口径**无终态**
    terminalStates: [],
    reconcile: {
      strategy: 'none',
      evidence:
        'packages/infra/src/state/background/BackgroundTaskStateMachine.ts#getBackgroundTaskStateMachine',
    },
    audit: {
      mode: 'exempt',
      reason:
        '进程内后台任务机（DreamEngine 等经 Registry 复用），实例无会话维度；运行结果由各任务自身事件/日志记录。',
    },
    note: '2026-11-24（P0-1）从豁免升级为登记：实例经 `StateMachineRegistry` 注册（DreamEngine 等消费），进程内运行态；`skipped` 非终态（可回 `running`/`idle`）；`completed`/`failed` 也允许回到 `running`（下一轮）⇒ 按出度无终态。',
  },
];

/**
 * **同名不同物 / 相邻词汇登记**（**有意不入 `STATE_MACHINES`**）。
 *
 * 这些"看起来像状态机"的定义属**其它域或其它层**，**严禁合并**（对齐 `MessageAttachment` 归属裁定口径）；
 * 登记它们是为了让"可枚举"不产生错觉（避免后续误并）。
 */
export const BOUNDARY_STATE_MACHINES: readonly {
  id: string;
  title: string;
  sourceFile: string;
  reason: string;
}[] = [
  {
    id: 'uiTaskStatus',
    title: 'UI 任务状态词汇表（TaskListV2）',
    sourceFile: 'app/src/components/TaskListV2.tsx',
    reason:
      '**前端 UI 词汇表**（6 态，含 `skipped`，无 `blocked/killed/lost`）≠ 状态机 `TaskStatus`（7 态）⇒ 不合并；如要统一须先将 UI 词汇表改为从 `core/taskStatus` 派生。',
  },
  {
    id: 'sessionModelClass',
    title: 'SessionState 类 + SESSION_STATES 集合（会话模型域）',
    sourceFile: 'packages/service/src/session/models/SessionState.ts',
    reason:
      '**同名不同物**（类与只读集合，非枚举）：是**状态容器**（`currentState` + history + config，可 `toJSON/fromJSON` 持久化）+ **词汇表超集**，≠ 会话状态机。**阶段 3 已处置（2026-10-12）**：裁定**保持独立**——其 8 值词汇表用于**接受既有持久化值**（P1-27：历史值 `active` 曾被拒）⇒ **只可放宽不可收紧**（收紧即行为回归）；对其头注中"对齐 8 状态枚举"的**失真表述已订正**。',
  },
  {
    id: 'goalSettlementStatus',
    title: 'GoalRunSettlement.status（批次落定结果）',
    sourceFile: 'app/src/tasks/goal/goalSettlementTypes.ts',
    reason:
      '**不同粒度**（单次 run 的落定结果，5 值）≠ `TaskGoalStatus`（目标生命周期，6 值）⇒ 不合并。',
  },
  {
    id: 'acpApprovalClass',
    title: 'AcpApprovalClass（ACP 审批分级）',
    sourceFile: 'app/src/acp/types.ts',
    reason:
      '**协议分级词汇**（含 `requires_approval` 等同名字面量但语义为 ACP 审批策略）≠ 工具执行瞬态 ⇒ 不合并。',
  },
  {
    id: 'pluginHostChildLogLevel',
    title: '插件子进程日志级别（`PluginContext.log` 的 `error`）',
    sourceFile: 'app/src/plugins/host/pluginHostEntry.ts',
    reason:
      '**日志级别**（`debug/info/warn/error`，随 `notify` 帧回传宿主）≠ 状态机取值；本文件无状态机（T25-08 P1）。',
  },
  {
    id: 'pluginHostNodeErrorEvent',
    title: '插件宿主内的 `error`：Node 子进程事件名 + ToolRegistry 选项值',
    sourceFile: 'app/src/plugins/host/PluginHostSupervisor.ts',
    reason:
      "**同名不同物**：`child.once('error')` 是 Node **事件名**、`registerTool(..., { onConflict: 'error' })` 是**撞名策略选项**（与 `SdkPluginAdapter` 同口径）⇒ 均非状态取值（T25-08 P1）。",
  },
  {
    id: 'dreamCycleStatus',
    title: '梦境周期记录状态（DreamCycleStatus）',
    sourceFile: 'packages/dream/src/dream/types.ts',
    reason:
      '**相邻词汇，不同物**：`completed/partial/failed/skipped` 是**按周期落盘的记录状态**（JSON `cycles/<id>.json` + `dream_cycles` 镜像），无转移规则、无 Registry 实例、无启动对账；≠ `backgroundTask` 运行态机（`skipped` 可回 `running`）。2026-11-25 新增 `skipped`（被门槛/节流/锁跳过，不计完成/经验）⇒ 不合一。',
  },
];

/** 已登记的状态机 id 列表（单点可枚举） */
export function listStateMachineIds(): string[] {
  return STATE_MACHINES.map((m) => m.id);
}

/** 按 id 查找已取证登记 */
export function findStateMachine(id: string): StateMachineEntry | undefined {
  return STATE_MACHINES.find((m) => m.id === id);
}
