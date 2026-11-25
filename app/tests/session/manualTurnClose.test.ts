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
 * 人工复位的事件侧收口（2026-11-25）。
 *
 * 真机 `sess-goal-start-1794938528619` / `session_mwpj4amge75a67ec4f`：崩溃恢复补的 closer 带
 * `synthetic: true`，探针 `classifyTurnTail` 仍判未闭合 ⇒ 只清 `failed_stale` 标记的复位会在
 * 下次硬重启被再标 stale。本文件锁住"复位时补写**非合成** `turn/end`"的口径。
 */
import { describe, expect, it } from 'bun:test';
import {
  closeOpenTurnForReset,
  MANUAL_RESET_FINISH_REASON,
} from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events';

interface PortsHarness {
  appended: LiriEvent[];
  queries: unknown[];
}

function harness(
  events: LiriEvent[],
  tailSeq: number,
  appendOk = true
): { ports: Parameters<typeof closeOpenTurnForReset>[0]; seen: PortsHarness } {
  const seen: PortsHarness = { appended: [], queries: [] };
  return {
    seen,
    ports: {
      sessionId: 's1',
      getTailSeq: async () => tailSeq,
      read: async (query) => {
        seen.queries.push(query);
        return events;
      },
      append: async (event) => {
        seen.appended.push(event);
        return { ok: appendOk };
      },
      now: 1_700_000_000_000,
    },
  };
}

function turnEvent(
  type: 'turn/start' | 'turn/end',
  turn: number,
  extra: Record<string, unknown> = {}
): LiriEvent {
  return {
    type: type as never,
    seq: 0,
    time: 0,
    sessionId: 's1',
    data: { turn, ...extra } as never,
  };
}

describe('closeOpenTurnForReset（人工复位：非合成 turn/end）', () => {
  it('只有合成 closer（synthetic=true）⇒ 补一条非合成 reset_by_user', async () => {
    const { ports, seen } = harness(
      [
        turnEvent('turn/start', 4),
        turnEvent('turn/end', 4, { finishReason: 'canceled', synthetic: true }),
      ],
      10
    );

    expect(await closeOpenTurnForReset(ports)).toBe(1);
    expect(seen.appended).toHaveLength(1);
    const written = seen.appended[0]!;
    expect(written.type).toBe('turn/end');
    // §1.6 红线：seq 交由存储层原子分配
    expect(written.seq).toBe(0);
    expect(written.data).toEqual({
      turn: 4,
      finishReason: MANUAL_RESET_FINISH_REASON,
    });
    // 非合成：探针此后判"已闭合"
    expect((written.data as { synthetic?: boolean }).synthetic).toBeUndefined();
    // 只读尾部窗口（不做全量扫描）
    expect(seen.queries).toEqual([
      { fromSeq: 1, types: ['turn/start', 'turn/end'] },
    ]);
  });

  it('只有 turn/start ⇒ 同样补非合成 closer', async () => {
    const { ports, seen } = harness([turnEvent('turn/start', 2)], 2);
    expect(await closeOpenTurnForReset(ports)).toBe(1);
    expect((seen.appended[0]!.data as { turn: number }).turn).toBe(2);
  });

  it('真实 turn/end（非合成）⇒ 已闭合，不写事件（幂等）', async () => {
    const { ports, seen } = harness(
      [
        turnEvent('turn/start', 1),
        turnEvent('turn/end', 1, { finishReason: MANUAL_RESET_FINISH_REASON }),
      ],
      50
    );
    expect(await closeOpenTurnForReset(ports)).toBe(0);
    expect(seen.appended).toHaveLength(0);
  });

  it('无事件（tailSeq=0）⇒ 不读不写', async () => {
    const { ports, seen } = harness([turnEvent('turn/start', 1)], 0);
    expect(await closeOpenTurnForReset(ports)).toBe(0);
    expect(seen.queries).toHaveLength(0);
    expect(seen.appended).toHaveLength(0);
  });

  it('写入失败 ⇒ 返回 0（如实上报，不谎报复位成功）', async () => {
    const { ports } = harness([turnEvent('turn/start', 3)], 3, false);
    expect(await closeOpenTurnForReset(ports)).toBe(0);
  });

  it('尾部窗口：tailSeq 很大时只读最近 500 条', async () => {
    const { ports, seen } = harness([turnEvent('turn/start', 9)], 3992);
    await closeOpenTurnForReset(ports);
    expect(seen.queries).toEqual([
      { fromSeq: 3492, types: ['turn/start', 'turn/end'] },
    ]);
  });
});
