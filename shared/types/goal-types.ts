/**
 * 长程任务（Goal）**目标域词表** —— 双端唯一事实来源（2026-10-05，P1-18 / L4）
 *
 * ## 为什么放在 shared
 *
 * 这 4 个联合是**载荷引用类型**：后端事件载荷
 * （`app/src/session/types/eventPayloads.ts` 的 `goal/*` / `goal/deviation`）与前端
 * 事件镜像（`client/src/types/events.ts`）都要用到它们。此前两端**各写一份手写镜像**
 * （client 侧注释自述为"治标"，见 D-1 补镜像）⇒ 后端改词表、前端漏改即静默漂移（CS02 病理）。
 *
 * 4 者均为**纯字面量联合、零出向依赖** ⇒ 下沉 shared 零净差：`app` 与 `client`
 * 皆经由 `@shared/types`（既有别名/构建/Docker 均已就绪，见先例
 * `.trae/specs/chat-status-type-contract.md`）引用同一份定义。
 *
 * 原址（`app/src/types/goal.ts`）保留**再导出** ⇒ `@modules/types/goal` 桶与既有消费方
 * 零改动（依 R05-013 口径「再导出不计入类型中心冲突」）。
 */

/**
 * 目标状态（6 态）。
 *
 * - `active`：推进中（唯一的"可推进"状态）；
 * - `blocked`：受阻（**非终态** —— 允许 `blocked → active` 恢复，对齐 codex 的 `GOAL_RESUMED`）；
 * - `completed` / `budget_limited` / `failed` / `cancelled`：**终态**，落定后不可改写。
 */
export type TaskGoalStatus =
  | "active"
  | "blocked"
  | "completed"
  | "budget_limited"
  | "failed"
  | "cancelled";

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
  | "batch_completed"
  | "batch_blocked"
  | "batch_failed"
  | "batch_cancelled"
  | "budget_limit"
  | "stop_threshold"
  | "turn_error"
  | "compaction_stalled"
  // 二期 N2（2026-09-23 修复计划 §六）：**只记录、不计数**的"这一轮为何停下"原因码。
  // 语义上都不是"无进展" ⇒ 不得混入 `no_progress_streak`（`user_aborted` 更不得
  // 按用户意图相反地触发 idle 续接）。
  | "turn_limit"
  | "turn_timeout"
  | "turn_budget_exhausted"
  | "turn_interrupted"
  | "user_aborted"
  // 二期 O2-1（2026-09-24）：**系统中止**（断线 / 会话清理）与"用户主动放弃"区分
  | "system_aborted"
  | "manual";

/**
 * 目标**偏差严重度**（T-②02，2026-10-03）。
 *
 * 用途：事件载荷 `goal/deviation.severity` 与偏差判定纯函数
 * （`tasks/review/GoalDeviation.ts`）的**机器可读**面 —— 判定一律用本枚举，
 * **禁止**按文案推断（CS02）。分层沿用既有预算阈值
 * （`UNIFIED_THRESHOLDS.WARNING` / `CRITICAL`）⇒ 本仓**零新增常量**。
 */
export type GoalDeviationSeverity = "warning" | "critical";

/**
 * 长程任务专用模板的键集（模板文案仍在 `tasks/goal/goalTemplates.ts` 的 `GOAL_TEMPLATES`）。
 */
export type GoalTemplateKind =
  | "budget_limit"
  | "objective_updated"
  | "progress_stalled"
  | "continue_goal"
  | "tool_execution_errors";
