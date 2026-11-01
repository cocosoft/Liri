/**
 * 会话状态机类型定义（**3 态**）
 *
 * ## 阶段 3（状态机规范管理方案，2026-10-12）：8 态 → 3 态收敛
 *
 * **取证结论（回仓，非推断）**：旧 8 态 `SessionState` 枚举**不是**遗留死码 —— 它是**活事实源**：
 *   - `chat/ChatManager.ts:3184`（`.start('processUserInput')`）· `:3338`（`.finish('工具执行完成')`）
 *   - `chat/orchestrator/ChatOrchestrator.ts:754`（`.start('sendMessage')`）· `:1166`（`.finish(...)`）
 *   - `chat/services/SessionStateBridge.ts`（**已在 `entrypoints/init.ts:479-490` 接线**）按
 *     `session:activated/paused/resumed/archived/error` 分别调 `.start/.pause/.resume/.complete/.error`
 *
 * ⇒ 依**用户裁定（2026-10-12）执行 8→3 收敛**。**如实记录降级代价**（折叠映射，与 Phase 1 既定的
 * `toSimplifiedState()` 逐值一致）：
 *
 * | 旧 8 态 | → 3 态 |
 * |---|---|
 * | `IDLE` / `COMPLETED` / `ARCHIVED` / `ABORTED` | `idle` |
 * | `RUNNING` | `running` |
 * | `REQUIRES_ACTION` / `PAUSED` / `ERROR` | `requires_action` |
 *
 * 随 8 态一并**删除**的 3 项（取证：零消费者 / 无输入类型）：
 *   ① 旧 `SessionState` 枚举本体（8 态）；
 *   ② `toSimplifiedState()`（8→3 映射函数）—— 8 态消失后**无输入类型**；
 *   ③ 独立的终态语义（`COMPLETED/ARCHIVED/ABORTED`）—— 3 态下 `idle` **可再次 `start()`** ⇒ 生命周期**成环**、
 *      **无终态**，`isTerminal()` 恒 `false`（旧表以 `ARCHIVED/ABORTED` 为终态）。
 *
 * **无数据/外部入口依赖（取证，故无需迁移映射）**：旧 8 态**不持久化**（见方案 §1 清点表 #5「持久化：无」）；
 * `EventNotificationService.emitSessionStateChanged()` 亦**零调用点**。
 */

import type { TransitionRules } from '../engine/types';

/**
 * 会话状态（**唯一事实源**，3 态）。
 *
 * `SimplifiedSessionState` 名称保留（方案与定义目录口径一致；不再改名以避免额外重命名面）。
 */
export type SimplifiedSessionState = 'idle' | 'running' | 'requires_action';

/**
 * 会话状态转移规则表（3 态，唯一事实源）。
 *
 * 由旧 8 态表按上述折叠映射**逐边归并**而来：
 * - `idle → running`（原 `IDLE → RUNNING`）
 * - `running → idle`（原 `RUNNING → IDLE` 与 `COMPLETED/ABORTED` 的归并结果）
 * - `running → requires_action`（原 `RUNNING → REQUIRES_ACTION/PAUSED/ERROR` 三条边归并）
 * - `requires_action → running`（原 `REQUIRES_ACTION/PAUSED/ERROR → RUNNING`）
 * - `requires_action → idle`（原 `ERROR → IDLE` 与 `REQUIRES_ACTION/PAUSED → ABORTED`）
 *
 * ⚠️ **同目标再触发是安全幂等**：引擎 [`StateMachine.transition`](../engine/StateMachine.ts)
 * 对 `from === to` **早返回 `true`**（记 `状态未变` debug，不抛）⇒ 3 态折叠后不可避免的
 * "已在 `requires_action` 时再来 `pause()`/`error()`" **不会**新增异常面
 * （旧 8 态表本就允许 `REQUIRES_ACTION → PAUSED/ERROR`）。
 *
 * ⚠️ 字面量由 `TransitionRules<SimplifiedSessionState>` **类型约束** ⇒ 拼写漂移在**编译期**失败，
 * 故不再引入 `SESSION_STATE_*` 常量（CS01：不重复造；且 `SESSION_STATES` 之名已被
 * `session/models/SessionState.ts:44` 占用，另起名会构成同名不同物）。
 */
export const SESSION_TRANSITIONS: TransitionRules<SimplifiedSessionState> = {
  idle: ['running'],
  running: ['idle', 'requires_action'],
  requires_action: ['running', 'idle'],
};

/**
 * 待处理动作详情
 *
 * 当会话进入 `requires_action` 状态时，描述需要用户做什么操作。
 */
export interface RequiresActionDetails {
  /** 需要用户确认的工具名称 */
  tool_name: string;
  /** 动作描述 */
  action_description: string;
  /** 工具调用 ID */
  tool_use_id: string;
  /** 请求 ID */
  request_id: string;
  /** 工具输入参数 */
  input?: Record<string, unknown>;
}
