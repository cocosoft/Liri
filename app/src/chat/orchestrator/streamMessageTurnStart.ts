/**
 * streamMessageFlow 的「**turn/start 事件写入**」——首轮一次性落 `turn/start`（P2-1l）。
 *
 * 动因（S4 事件持久化 · turn 边界）：该段此前**内联**在 `runStreamMessage` 的重试循环内
 * （约 28 行）：从事件日志恢复最大 turn、与内存计数器取较大者 +1、追加 `turn/start`
 * （失败仅 `debug` 留痕，不阻断流式）。两条既有修复口径（"仅首轮""重启后不重复编号"）
 * 与其背景全沉在编排函数里 ⇒ 无法独立测试。
 *
 * 拆分手法（与 P2-1k 一致）：**判据与动作收口为单一职责单元**，编排函数内只保留
 * **一次调用 + 一次状态回填**（`turnStarted` / `currentTurnNo` 是跨 `if` 的可变状态，
 * 留在编排函数）。
 *
 * 既有修复口径（随迁保留）：
 * - **P0-fix**：**仅首轮**写入 `turn/start`，重试时跳过（避免重复写入相同 turn 编号）；
 * - **P0-fix-2（2026-08-23）**：turn 编号改用**事件日志恢复的最大 turn + 1**，避免后端重启后
 *   `toolRoundCount` 归零导致 turn 编号从 1 重复（前端误判重复回放并删除新对话）。内存计数器
 *   取两者**较大值**兜底。
 *
 * **唯一非逐字的等价化简**：原内联块的局部 `let streamTurnSeq = 0`（声明后又被赋 `= 0`）只用于
 * `seq: streamTurnSeq` ⇒ 直接写 `seq: 0`（行为零变化，去掉死变量）。
 */

import { getLogger } from '@modules/monitoring';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

// 复用与原编排函数**同名**的 logger ⇒ 日志 `module` 字段与拆分前逐字一致（`chat:streamFlow`）。
const logger = getLogger('chat:streamFlow');

export interface StartTurnDeps {
  host: ChatOrchestratorHost;
  sessionId: string;
}

export interface StartTurnResult {
  /** 是否成功写入（失败 ⇒ `false`，调用方**不**置 `turnStarted`，下轮可重试） */
  started: boolean;
  /** 本次分配的 turn 编号（`max(persistedTurn, toolRoundCount) + 1`；失败时为 0） */
  turnNo: number;
}

/**
 * 写入本轮 `turn/start`（详见模块头注）。
 *
 * **不抛错**：追加失败仅 `debug` 留痕（CS03：事件写入失败不阻断流式）。
 */
export async function startStreamTurn(
  deps: StartTurnDeps
): Promise<StartTurnResult> {
  const { host, sessionId } = deps;
  try {
    // 从事件日志恢复最大 turn（重启后继续递增），兜底取内存计数器的较大值
    const [persistedTurn, memTurn] = await Promise.all([
      host.getStreamMaxTurn(sessionId),
      Promise.resolve(host.toolRoundCount),
    ]);
    const nextTurn = Math.max(persistedTurn, memTurn) + 1;
    // P3-7a：turn/start 的 seq 交由 append 原子分配（seq=0）
    await host.appendStreamEvent(sessionId, {
      type: 'turn/start',
      seq: 0,
      time: Date.now(),
      sessionId,
      data: { turn: nextTurn },
    });
    return { started: true, turnNo: nextTurn };
  } catch (e) {
    // @ignore-catch — 事件追加失败不阻断流式（CS03）
    logger.debug('streamMessageFlow: turn/start 追加失败', {
      sessionId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { started: false, turnNo: 0 };
  }
}
