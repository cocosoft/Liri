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
 * 人工复位：把未闭合轮次以**非合成** `turn/end` 正式闭合（2026-11-25）。
 *
 * 背景（真机 `sess-goal-start-1794938528619` / `session_mwpj4amge75a67ec4f`）：
 * 崩溃恢复会给未闭合轮次补一条 `turn/end { finishReason: 'canceled', synthetic: true }`，
 * 按 `classifyTurnTail` 的口径它**仍算未闭合**（否则真实中断会被误当正常收尾）⇒
 * 只清 `failed_stale` 标记的 `recover-stale` 复位会在下次硬重启被再次判 stale。
 *
 * 人工复位代表**用户确认该轮结束** ⇒ 补一条**非合成** closer（`finishReason='reset_by_user'`），
 * 探针此后判"已闭合"，复位才持久。
 *
 * 端口注入（`getTailSeq` / `read` / `append`）：本函数不依赖 app 层 `ChatManager`，
 * 由调用方用既有公共能力适配 ⇒ 无分层倒挂，且可直接单测。
 */

import type { LiriEvent } from '../types/events';
import type { EventLogQuery } from '../storage/EventLogStorage';
import { classifyTurnTail, type TurnTailEvent } from './turnTail';

/**
 * 尾部扫描窗口（事件条数）。只需覆盖"最后一个 turn 的收尾事件"，
 * 与崩溃恢复探针的 `TAIL_SCAN_WINDOW` 同量级即可。
 */
const MANUAL_RESET_TAIL_WINDOW = 500;

/** 人工复位写入的收尾原因（结构化字段，禁止靠文案判断 — CS02） */
export const MANUAL_RESET_FINISH_REASON = 'reset_by_user';

export interface ManualTurnClosePorts {
  sessionId: string;
  /** 取事件日志尾 seq（`ChatManager.getStreamTailSeq`） */
  getTailSeq(): Promise<number>;
  /** 读事件（`ChatManager.readSessionEvents`） */
  read(query: EventLogQuery): Promise<LiriEvent[]>;
  /** 追加事件（`ChatManager.appendStreamEvent`；`seq: 0` 由存储层原子分配） */
  append(event: LiriEvent): Promise<{ ok: boolean }>;
  /** 测试可注入的时钟 */
  now?: number;
}

/** 取最近一条轮次事件里的 turn 号（`turn/start` / `turn/end` 都带 `data.turn`） */
function lastTurnNumber(events: readonly TurnTailEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'turn/start' && event.type !== 'turn/end') continue;
    const turn = Number((event.data as { turn?: unknown } | undefined)?.turn);
    if (Number.isInteger(turn) && turn > 0) return turn;
  }
  return 0;
}

/**
 * 若该会话最后一个轮次**未闭合**（含"只有合成 closer"）⇒ 追加一条非合成 `turn/end`。
 *
 * @returns 实际写入条数（0 = 已闭合 / 无轮次事件 / 写入失败）
 */
export async function closeOpenTurnForReset(
  ports: ManualTurnClosePorts
): Promise<number> {
  const tailSeq = await ports.getTailSeq();
  if (!tailSeq || tailSeq <= 0) return 0;

  const events = await ports.read({
    fromSeq: Math.max(1, tailSeq - MANUAL_RESET_TAIL_WINDOW),
    types: ['turn/start', 'turn/end'],
  });
  if (!classifyTurnTail(events).open) return 0;

  const turn = lastTurnNumber(events);
  if (turn <= 0) return 0;

  const result = await ports.append({
    type: 'turn/end',
    seq: 0,
    time: ports.now ?? Date.now(),
    sessionId: ports.sessionId,
    data: { turn, finishReason: MANUAL_RESET_FINISH_REASON },
  } as LiriEvent);
  return result.ok ? 1 : 0;
}
