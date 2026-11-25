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
 * 「最后一个 turn 是否已闭合」的**纯判定**（2026-11-25 由
 * `app/src/chat/manager/sessionStatusReconcile.ts` 下沉到 service，成为单一事实源）。
 *
 * 为什么下沉：崩溃恢复探针（app）与人工复位（`recover-stale`）必须**同一判据**，
 * 而 `recover-stale` 的调用方在 runtime（service 层）——判据留在 app 层会造成
 * `runtime → chat` 的分层违规（R00-001），或在两处复制同一逻辑（CS01 禁止）。
 */

/** 结构化事件（只取判定所需字段，便于纯函数单测） */
export interface TurnTailEvent {
  type: string;
  data?: unknown;
}

export interface TurnTailInfo {
  /** 最后一个 turn 仍未闭合（`turn/start` 之后无真实 `turn/end`） */
  open: boolean;
  /** 尾部窗口内是否读到过 turn 事件（`false` ⇒ 旧会话，从未被轮次包裹） */
  hasTurn: boolean;
  /** 真实 `turn/end` 的收尾原因（`open` 时不提供） */
  finishReason?: string;
  terminationReason?: string;
}

/**
 * 判定"最后一个 turn 是否已闭合"（纯函数）。
 *
 * - 最后一条 turn 事件是 `turn/start` ⇒ 未闭合；
 * - 最后一条是 **合成** `turn/end`（`data.synthetic=true`，崩溃恢复补写的 closer）⇒ 该轮实为中断
 *   ⇒ 视为未闭合（不得据此收回徽标）；
 * - 最后一条是真实 `turn/end` ⇒ 已闭合，并带回收尾原因。
 */
export function classifyTurnTail(
  events: readonly TurnTailEvent[]
): TurnTailInfo {
  let last: TurnTailEvent | undefined;
  for (const event of events) {
    if (event.type === 'turn/start' || event.type === 'turn/end') last = event;
  }
  if (!last) return { open: false, hasTurn: false };
  if (last.type === 'turn/start') return { open: true, hasTurn: true };

  const data = last.data as
    | {
        finishReason?: unknown;
        terminationReason?: unknown;
        synthetic?: unknown;
      }
    | undefined;
  if (data?.synthetic === true) return { open: true, hasTurn: true };
  return {
    open: false,
    hasTurn: true,
    finishReason:
      typeof data?.finishReason === 'string' ? data.finishReason : undefined,
    terminationReason:
      typeof data?.terminationReason === 'string'
        ? data.terminationReason
        : undefined,
  };
}
