// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `sessions_yield` 契约常量（阶段 A / A1-a）
 *
 * 对标 LobsterAI `src/shared/cowork/subagent.ts`，口径见
 * `.trae/documents/阶段A-yield真实实现Spec.md` §3-D1：**值保留、结构按 Liri 载体重写**。
 *
 * - 值保留：字面值与对标实现一致（便于后续比对）；
 * - 结构重写：判定函数（`yieldDetection.ts`）的输入是 **Liri 真实载体**
 *   （`turn/end` 事件 data / 工具结果 / 消息序列），
 *   不照抄对标实现的 run 生命周期对象 —— 其 `phase` / `livenessState` / `turnToken`
 *   在 Liri 侧不存在，照抄会得到永久返回 false 的死判定。
 *
 * 说明：对标契约的 `stopReason:'end_turn'` 与 `livenessState:'paused'` 在 Liri 侧
 * 分别退化为 `turn/end.data.finishReason` 与 `YieldRegistry` 的 waiting 态，
 * 故不设同名字面量（避免出现无消费者的死常量）。
 */

/** yield 工具名（与工具注册名一致，勿改） */
export const YIELD_TOOL_NAME = 'sessions_yield';

/** 工具结果 data.status 的 yield 成功值 */
export const YIELD_RESULT_STATUS = 'yielded';

/** `turn/end` 事件 data.finishReason 的 yield 收尾值（与上一常量同值但契约位不同） */
export const YIELD_FINISH_REASON = 'yielded';

/** YieldRegistry 条目状态：等待子代理结算 */
export const YIELD_STATUS_WAITING = 'waiting';

/**
 * YieldRegistry 条目状态：**已认领（正在恢复中）** —— B1-1（P0-1）新增的中间态。
 *
 * 语义：某一条恢复路径已通过**同步 CAS** 独占该等待（`get()` 不再返回本条目），
 * 其他并发结算路径必须放弃。落此态后由认领者收敛为 `resumed` / `abandoned`。
 */
export const YIELD_STATUS_CLAIMED = 'claimed';

/** YieldRegistry 条目状态：已恢复（结算收敛后落此终态） */
export const YIELD_STATUS_RESUMED = 'resumed';

/** YieldRegistry 条目状态：已作废（本轮 turn 已推进，旧登记不得复用） */
export const YIELD_STATUS_ABANDONED = 'abandoned';
