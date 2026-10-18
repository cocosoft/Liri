/**
 * S7 终态提交 —— 流式收尾片段（U-18/S7，2026-10-18）
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-**S7** / §5（逐阶段拆分，每阶段一 PR）。
 *
 * ## 为什么外移
 * `runStreamMessage` 的 `finally` 是**终态提交的唯一收尾点**（S2 所有权释放 + S7 终态写入），
 * 顺序敏感且注释密度高。原实现内嵌在编排函数尾部，既推高函数行数，也让"顺序为何不可调换"
 * 的口径难以复用。本模块**逐字搬迁**该片段，语义与顺序**零变更**：
 *
 * 1. **资源释放**（最先）：`releaseStreamOwnership`（唯一释放点）+ 结束 interaction span；
 * 2. **兜底检查点**：`savePlainTextCheckpoint(trigger='fallback')`；
 * 3. **结束 stream span**（失败仅忽略 —— span 可能已结束）；
 * 4. **中止补齐**（最后）：`turn/start` 已写但 `turn/end` 未写 ⇒ 补 `canceled`
 *    （与 `EventLogRepair` 同口径；append 失败只 warn，不阻断，CS03）。
 *
 * ## 边界
 * - **不改变控制流**：本函数不 `return`、不 `throw`（除 `emitEvent` 内部已自带 fail-safe）；
 * - **只读传入状态**：`turnTrace` / `mutexHeld` / `governorAdmitted` 仅读，不回写；
 * - 顺序即契约：第 1 步不可因第 4 步 append 失败而跳过（见原实现注释）。
 */

import { getLogger, getOTelTracing } from '@modules/monitoring';
import type { ChatSession } from '@modules/session/types/session.js';
import type { PlainTextCheckpoint } from '../services/PlainTextCheckpoint.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import type { PreparedStream } from './streamMessagePrepare.js';
import { releaseStreamOwnership } from './streamMessageOwnership.js';
import { savePlainTextCheckpoint } from './plainTextCheckpointSave.js';
import type {
  EmitFailureTrace,
  StreamAppendResult,
  StreamEventPayload,
} from './streamMessageEvents.js';

const logger = getLogger('chat:streamFinalize');

/** 事件发射器（与 `makeEventEmitter` 的返回签名一致） */
type StreamEventEmitter = (
  event: StreamEventPayload,
  onFailure?: EmitFailureTrace
) => Promise<StreamAppendResult>;

/** `turn/start` ↔ `turn/end` 配对追踪（只读；写入发生在本片段之外） */
export interface StreamTurnTrace {
  started: boolean;
  turnNo: number;
  ended: boolean;
}

export interface FinalizeStreamFlowParams {
  host: ChatOrchestratorHost;
  session: ChatSession;
  mutex: PreparedStream['ctx']['mutex'];
  mutexHeld: boolean;
  governorAdmitted: boolean;
  turnTrace: StreamTurnTrace;
  emitEvent: StreamEventEmitter;
  streamSpan: PreparedStream['ctx']['streamSpan'];
  streamAbortController: PreparedStream['ctx']['streamAbortController'];
  plainTextCheckpoint: PlainTextCheckpoint;
  interactionTracing: PreparedStream['interactionTracing'];
}

/**
 * 执行流式收尾（原 `runStreamMessage` 的最外层 `finally` 片段）。
 *
 * 调用方必须放在 `finally` 中（正常返回与异常/中止路径都要走）；本函数自身**不抛错**。
 */
export async function finalizeStreamFlow(
  params: FinalizeStreamFlowParams
): Promise<void> {
  const {
    host,
    session,
    mutex,
    mutexHeld,
    governorAdmitted,
    turnTrace,
    emitEvent,
    streamSpan,
    streamAbortController,
    plainTextCheckpoint,
    interactionTracing,
  } = params;

  // P2 修复（AB-2）+ BUG-1/2 收敛 + P2-1e：**唯一释放点**，释放恰好一次。
  // 「只释放确实持有的」「内层不再 release」「时序为何不可外移」等口径沉淀在
  // `releaseStreamOwnership` 头注（S2/S7 所有权）。
  releaseStreamOwnership(mutex, session.id, mutexHeld, governorAdmitted);
  // TR-20 续：结束 interaction span —— 与 mutex 同在**唯一释放点**，保证恰好一次
  // （`endInteractionSpan` 自身有 `spanContext` 与 `ended` 双重守卫，重复调用无害）
  interactionTracing.endInteractionSpan();
  // P2（08-09）：兜底检查点
  savePlainTextCheckpoint({
    checkpoint: plainTextCheckpoint,
    session,
    trigger: 'fallback',
  });

  try {
    getOTelTracing().endSpan(streamSpan);
  } catch {
    /* span 可能已结束 */
  }

  // 中止补齐（2026-10-16）：`turn/start` 已写、`turn/end` 未写 ⇒ 本轮**无终态**
  //（客户端中止：切走会话 / 关页 / 断连，消费方 `.return()` 关闭生成器；或异常穿透）。
  // 补写 `canceled` 与 `EventLogRepair`（崩溃恢复期补闭合）**同口径** ⇒ 事件派生会带上
  // `finishReason: 'canceled'`，前端 `ChatMessage` 据此显示"该回复已中断（任务被中止）"，
  // 而不是切回会话后看到进度冻结的假空闲。
  // ⚠ 顺序：必须放在既有清理之后 —— 上面几步是**资源释放**，不可因 append 失败而跳过；
  // append 自身失败只 warn（与非阻断口径一致，CS03）。
  if (!turnTrace.started || turnTrace.ended) return;
  try {
    await emitEvent({
      type: 'turn/end',
      seq: 0,
      time: Date.now(),
      sessionId: session.id,
      data: {
        turn: turnTrace.turnNo > 0 ? turnTrace.turnNo : host.toolRoundCount + 1,
        finishReason: 'canceled',
      },
    });
    logger.warn(
      'streamMessageFlow: turn 中止未闭合 ⇒ 补写 turn/end(canceled)',
      {
        sessionId: session.id,
        turn: turnTrace.turnNo,
        aborted: streamAbortController.signal.aborted,
      }
    );
  } catch (err) {
    logger.warn('streamMessageFlow: 补写 turn/end(canceled) 失败', {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
