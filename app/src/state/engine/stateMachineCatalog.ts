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
  /** 补充说明（同名不同物 / 双事实源等） */
  note?: string;
}

/**
 * **已取证登记**（阶段 1.3 完成：9 台机器 + 1 套简化状态，取值逐项与源码核对）。
 */
export const STATE_MACHINES: readonly StateMachineEntry[] = [
  {
    id: 'execution',
    title: '执行状态机（Execution）',
    kind: 'persistent',
    sourceFile: 'app/src/execution/types.ts',
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
      module: 'app/src/execution/types.ts',
      exportName: 'EXECUTION_STATUSES',
      anchor: 'array',
    },
    hasTransitionFn: true,
  },
  {
    id: 'toolCall',
    title: '工具调用状态机（ToolCall）',
    kind: 'persistent',
    sourceFile: 'app/src/execution/types.ts',
    states: ['running', 'completed', 'failed', 'unknown'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'app/src/execution/types.ts',
      exportName: 'TOOL_CALL_STATUSES',
      anchor: 'array',
    },
    hasTransitionFn: true,
  },
  {
    id: 'budgetMode',
    title: '预算档位（BudgetMode）',
    kind: 'persistent',
    sourceFile: 'app/src/query/dailyBudgetSnapshot.ts',
    states: ['normal', 'report_only', 'locked'],
    verification: 'source-read',
    hasTransitionFn: false,
    note: '**已于 2026-10-12 去重（阶段 1.3 隐患修复）**：单一事实源 = `dailyBudgetSnapshot.ts:31`（`export type`）；`DailyBudgetManager.ts` 已改为 `import type`（不再本地重声明）；前端镜像 `client/src/services/usageService.ts:113` 改名 `DailyBudgetMode`。',
  },
  {
    id: 'dedupProcess',
    title: 'dedup 消息处理态（MessageProcessingState）',
    kind: 'persistent',
    sourceFile: 'app/src/channels/dedup/types.ts',
    states: ['RECEIVED', 'ADMITTED', 'REJECTED'],
    verification: 'source-read',
    hasTransitionFn: false,
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
    note: '同文件另有步骤级 `WorkflowStepOutcome`（`:144`，3 值不同）—— 属不同粒度，未合并。',
  },
  {
    id: 'appState',
    title: '应用状态（AppState 4 态）',
    kind: 'persistent',
    sourceFile: 'app/src/state/app/types.ts',
    states: ['idle', 'busy', 'paused', 'error'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'app/src/state/app/types.ts',
      exportName: 'AppState',
      anchor: 'enum',
    },
    hasTransitionFn: true,
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
    note: '**已于 2026-10-12 抽为命名类型（阶段 1.3 隐患修复）**：`export type AppInstallStatus`（`AppState.ts`），原 `:253`/`:259` 两处内联重复已消除。',
  },
  {
    id: 'sessionState',
    title: '会话状态机（SessionState **3 态**）',
    kind: 'persistent',
    sourceFile: 'app/src/state/session/types.ts',
    states: ['idle', 'running', 'requires_action'],
    verification: 'runtime-import',
    verifyRef: {
      module: 'app/src/state/session/types.ts',
      // 3 态为**类型联合**（无 enum）⇒ 运行时锚点取转移规则表的**键**（`anchor: 'objectKeys'`）
      exportName: 'SESSION_TRANSITIONS',
      anchor: 'objectKeys',
    },
    hasTransitionFn: true,
    note: '**阶段 3（2026-10-12）8 态 → 3 态收敛（用户裁定）**：旧 `SessionState` 8 态枚举与 `toSimplifiedState()` 已删除（前者零消费者、后者失输入类型）；折叠映射 = `IDLE/COMPLETED/ARCHIVED/ABORTED→idle`、`RUNNING→running`、`REQUIRES_ACTION/PAUSED/ERROR→requires_action`。**无终态**（`idle` 可再 `start()` ⇒ 生命周期成环，`isTerminal()` 恒 `false`）。历史事实源（活）：`ChatManager:3184/3338` · `ChatOrchestrator:754/1166` · `SessionStateBridge`（`init.ts:479-490` 已接线）。`app/src/session/models/SessionState.ts:44` 另有**同名不同物**（类 + `SESSION_STATES` 集合），见 `BOUNDARY_STATE_MACHINES`。',
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
    note: '**同名不同物**：`app/src/components/TaskListV2.tsx:9` 另有 6 态 UI 词汇表（含 `ALL_TASK_STATUSES`），见 `BOUNDARY_STATE_MACHINES`。',
  },
  {
    id: 'toolExecutionTransient',
    title: '工具执行瞬态（requires_approval / awaiting_approval）',
    kind: 'transient',
    sourceFile: 'app/src/utils/toolContract/ToolResult.ts',
    states: ['requires_approval', 'awaiting_approval'],
    verification: 'source-read',
    hasTransitionFn: false,
    note: '按方案阶段 2.3 裁断：**工具执行瞬态**，**不进** `ToolCallStatus` 持久化枚举。**已于 2026-10-12 消除裸字面量（阶段 1.3 隐患修复）**：`awaiting_approval` 唯一事实源 = `ToolExecutionService.ts` 的 `TRANSIENT_AWAITING_APPROVAL` 常量（原 2 处裸字面量已替换）；`requires_approval` 唯一事实源 = `ToolExecutionStatus.REQUIRES_APPROVAL`（`ToolResult.ts:12`，原比较处的裸字符串已替换）。',
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
    sourceFile: 'app/src/session/models/SessionState.ts',
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
];

/** 已登记的状态机 id 列表（单点可枚举） */
export function listStateMachineIds(): string[] {
  return STATE_MACHINES.map((m) => m.id);
}

/** 按 id 查找已取证登记 */
export function findStateMachine(id: string): StateMachineEntry | undefined {
  return STATE_MACHINES.find((m) => m.id === id);
}
