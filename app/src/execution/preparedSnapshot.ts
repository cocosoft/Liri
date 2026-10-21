/**
 * preparedSnapshot — 执行域「PREPARED 快照」**durable 落盘**（T1-13 / `✅-4`，2026-10-13）。
 *
 * 见 `.trae/specs/execution-prepared-snapshot-persistence.md`。
 *
 * ## 与四原语**遥测广播**的区别（关键，勿混同）
 * - `execution/executionProjection.ts` 的 `publishExecutionProjection` 是**只读带外广播**（telemetry），
 *   受 `STATE_PROJECTION_BROADCAST`（**默认关**）门控 ⇒ 关时**零落盘**；
 * - 本模块是**落盘事实**（写前持久化）：经既有 `execution/eventSink.ts` 追加会话事件，
 *   **不受** `STATE_PROJECTION_BROADCAST` 门控 ⇒ 重放（`recover`）可读回落盘快照。
 *
 * ## 为什么不复用 `RequestSnapshotService`
 * `chat/services/RequestSnapshotService.ts`（`context/model-input`）记的是 **trim 前 + 全量注册表**；
 * 本快照记 **trim 后最终可见集**（**只存工具名**，schema 正文仍由前者承担）⇒ 二者**口径不同、不合并**（CS01）。
 *
 * ## 落点（P-B，用户 2026-10-13 裁定）
 * 请求准备点（**首次模型请求之前**）由 chat 编排层调用本 API —— 该点是唯一能**一次落齐可见集**
 * 且为真正 **write-ahead** 的位置。`execution`(service) **不反向依赖** app ⇒ 由宿主侧调用（同 `emitExecutionEvent`）。
 */

import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
import { getLogger } from '@modules/monitoring';
import { emitExecutionEvent } from './eventSink';
import { getExecutionManager } from './ExecutionManager';
import type { ExecutionId } from './types';

const logger = getLogger('execution:preparedSnapshot');

/** PREPARED 快照载荷（与 `LiriEventMap['execution/prepared']` 同源，不另立契约） */
export type PreparedSnapshotPayload = LiriEventMap['execution/prepared'];

/** 落盘入参（调用方只需给会话 + 执行身份 + 可见集；`generation` 由本模块按执行记录补齐） */
export interface EmitPreparedSnapshotInput {
  sessionId: string;
  executionId: string;
  /** 归属消息 id（入口未下传 ⇒ 省略） */
  messageId?: string;
  /** 本轮**最终可见**工具名（可含重复；本模块去重 + 稳定排序） */
  visibleTools: readonly string[];
  /** 裁剪判据（`selectToolsForTurn` 产物；未判定 ⇒ 省略） */
  taskType?: string;
}

/**
 * 落一条 PREPARED 快照会话事件（**durable**，`STATE_PROJECTION_BROADCAST` 关时**仍落**）。
 *
 * 失败语义：追加失败由 `emitExecutionEvent` 内部仅 warn（观测面失败不回流主链路，CS03）。
 * 执行记录缺失 ⇒ **不臆造** `generation`（CS04：空即空）⇒ 如实留痕后**不落盘**。
 */
export function emitPreparedSnapshot(input: EmitPreparedSnapshotInput): void {
  const rec = getExecutionManager().get(input.executionId as ExecutionId);
  if (!rec) {
    logger.warn('PREPARED 快照未落盘（执行记录缺失，不臆造 generation）', {
      sessionId: input.sessionId,
      executionId: input.executionId,
    });
    return;
  }

  const visibleTools = [...new Set(input.visibleTools)].sort();
  emitExecutionEvent(input.sessionId, 'execution/prepared', {
    executionId: input.executionId,
    generation: rec.generation,
    visibleTools,
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
    ...(input.taskType !== undefined ? { taskType: input.taskType } : {}),
  });
}

/** 类型守卫：`execution/prepared` 事件（用于以 `LiriEventMap` 收窄 `data`，避免裸断言） */
function isPreparedEvent(ev: LiriEvent): ev is LiriEvent<'execution/prepared'> {
  return ev.type === 'execution/prepared';
}

/**
 * 从会话事件流取**最近一条** PREPARED 快照（无 ⇒ `null`）。
 *
 * 供重放路径**读落盘快照**（**严禁**直读当前运行时 Profile）；纯函数、无副作用。
 */
export function pickPreparedSnapshot(
  events: readonly LiriEvent[]
): PreparedSnapshotPayload | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev && isPreparedEvent(ev)) return ev.data;
  }
  return null;
}

/**
 * **重放强制集**（R-A，2026-10-13）：从会话事件流解析「应强制套用的可见工具面」。
 *
 * 语义 = 「重放**必须**读落盘快照、**严禁**直读当前运行时 Profile」（`✅-4`）：
 * 返回快照的 `visibleTools`（无快照 ⇒ `null`，调用方**如实不强制**、不臆造）。
 *
 * 唯一生产消费者 = `ChatManager._resumeSuspendedStream` 的「重发一轮」分支
 * （受 `PREPARED_SNAPSHOT_REPLAY`，**默认开**；`FEATURE_PREPARED_SNAPSHOT_REPLAY=false` 可关闭）。
 */
export function resolveReplayVisibleTools(
  events: readonly LiriEvent[]
): string[] | null {
  return pickPreparedSnapshot(events)?.visibleTools ?? null;
}
