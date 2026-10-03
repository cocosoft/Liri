/**
 * 2026-10-01 B11 前置 P1（D-223）—— 长程任务**目标域词表**下沉类型中心（app → core）。
 *
 * 动机：`session/types/eventPayloads.ts` 直接引 `@modules/tasks`(app) 的这三个类型 ⇒ 该契约
 * 文件按 B11 方案（改归 `session/types/`，service）迁移时，会经传递闭包新增
 * `session -> tasks`（service → app）**倒挂**（B11 blocker ②）。
 *
 * 三者均为**纯字面量联合、零出向依赖** ⇒ 下沉 core 零净差；各消费方（`chat`(app) ·
 * `tasks`(app)）引用 core 皆为**合法方向**（§9.2 原则 3：落点层 ≤ 消费方最低层）。
 *
 * 原址（`tasks/goal/TaskGoalStore.ts` · `tasks/goal/goalTemplates.ts`）保留**再导出** ⇒
 * `@modules/tasks` 桶与既有消费方零改动；依 R05-013 口径「再导出不计入类型中心冲突」。
 */

/**
 * 目标状态（6 态）。
 *
 * - `active`：推进中（唯一的"可推进"状态）；
 * - `blocked`：受阻（**非终态** —— 允许 `blocked → active` 恢复，对齐 codex 的 `GOAL_RESUMED`）；
 * - `completed` / `budget_limited` / `failed` / `cancelled`：**终态**，落定后不可改写。
 */
export type TaskGoalStatus =
  | 'active'
  | 'blocked'
  | 'completed'
  | 'budget_limited'
  | 'failed'
  | 'cancelled';

/**
 * **状态迁移 / 字段变更的原因码**（B2-2，2026-09-23）。
 *
 * 用途：事件载荷 `goal/status_changed.reason` 与 `goal/updated.reason` 的**机器可读**面
 * ——"为何停下"的唯一答案（`.trae/specs/goal-entity.md` §4.1）。
 * 判定一律用本枚举，**禁止**按 `objective` 文案或用户可见字符串推断（CS02）。
 *
 * 取值说明（Spec §3.2 的枚举 + 本仓实际落定路径补齐的两条）：
 * - `batch_completed` / `batch_blocked` / `budget_limit` / `stop_threshold`：Spec 原文；
 * - `batch_failed` / `batch_cancelled`：**本仓补齐** —— 批次全败与批次取消也是真实落定路径，
 *   Spec 枚举未列（若不补，这两条路径只能落 `null` 原因，与"唯一答案"目标相悖）；
 * - `turn_error` / `compaction_stalled` / `manual`：属缺口 X9 / X10 / X4（本批未接，
 *   先按 Spec 登记词表，待其落地后由对应策略层产出）。
 */
export type TaskGoalUpdateReason =
  | 'batch_completed'
  | 'batch_blocked'
  | 'batch_failed'
  | 'batch_cancelled'
  | 'budget_limit'
  | 'stop_threshold'
  | 'turn_error'
  | 'compaction_stalled'
  // 二期 N2（2026-09-23 修复计划 §六）：**只记录、不计数**的"这一轮为何停下"原因码。
  // 语义上都不是"无进展" ⇒ 不得混入 `no_progress_streak`（`user_aborted` 更不得
  // 按用户意图相反地触发 idle 续接）。
  | 'turn_limit'
  | 'turn_timeout'
  | 'turn_budget_exhausted'
  | 'turn_interrupted'
  | 'user_aborted'
  // 二期 O2-1（2026-09-24）：**系统中止**（断线 / 会话清理）与"用户主动放弃"区分
  | 'system_aborted'
  | 'manual';

/**
 * 目标**偏差严重度**（T-②02，2026-10-03）。
 *
 * 用途：事件载荷 `goal/deviation.severity` 与偏差判定纯函数
 * （`tasks/review/GoalDeviation.ts`）的**机器可读**面 —— 判定一律用本枚举，
 * **禁止**按文案推断（CS02）。分层沿用既有预算阈值
 * （`UNIFIED_THRESHOLDS.WARNING` / `CRITICAL`）⇒ 本仓**零新增常量**。
 */
export type GoalDeviationSeverity = 'warning' | 'critical';

/**
 * 长程任务专用模板的键集（模板文案仍在 `tasks/goal/goalTemplates.ts` 的 `GOAL_TEMPLATES`）。
 */
export type GoalTemplateKind =
  | 'budget_limit'
  | 'objective_updated'
  | 'progress_stalled'
  | 'continue_goal'
  | 'tool_execution_errors';
