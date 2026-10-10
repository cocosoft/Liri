/**
 * P2-1l —— S4「turn/start 写入」恢复最大 turn + 失败留痕契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1l；实现见
 * `src/chat/orchestrator/streamMessageTurnStart.ts`。
 *
 * 锁定（P0-fix / P0-fix-2 事故防御）：
 * 1. turn 编号 = `max(事件日志恢复的最大 turn, 内存 toolRoundCount) + 1`（**重启后不重复**）；
 * 2. 追加 `turn/start`（`seq: 0` 交 append 原子分配）；
 * 3. 追加**失败不抛错** ⇒ 返回 `started=false`（调用方据此不置 `turnStarted`，下轮可重试）。
 */
import { describe, expect, it } from 'bun:test';

import { startStreamTurn } from '../../../src/chat/orchestrator/streamMessageTurnStart.js';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';

type AppendedEvent = {
  type?: string;
  seq?: number;
  sessionId?: string;
  data?: { turn?: number };
};

function fakeHost(opts: {
  persisted: number;
  toolRoundCount: number;
  reject?: boolean;
}) {
  const appended: Array<{ sessionId: string; ev: AppendedEvent }> = [];
  const host = {
    toolRoundCount: opts.toolRoundCount,
    getStreamMaxTurn: () => Promise.resolve(opts.persisted),
    appendStreamEvent: (sessionId: string, ev: AppendedEvent) => {
      appended.push({ sessionId, ev });
      return opts.reject
        ? Promise.reject(new Error('append failed'))
        : Promise.resolve({ ok: true });
    },
  } as unknown as ChatOrchestratorHost;
  return { host, appended };
}

const run = (opts: {
  persisted: number;
  toolRoundCount: number;
  reject?: boolean;
}) => {
  const { host, appended } = fakeHost(opts);
  return startStreamTurn({ host, sessionId: 's1' }).then((r) => ({
    r,
    appended,
  }));
};

describe('P2-1l S4 turn/start 写入 · 恢复最大 turn + 失败留痕', () => {
  it('持久化 turn 较大 ⇒ 用 `persisted + 1`，并带 `seq:0` 追加', async () => {
    const { r, appended } = await run({ persisted: 5, toolRoundCount: 2 });
    expect(r).toEqual({ started: true, turnNo: 6 });
    expect(appended).toHaveLength(1);
    expect(appended[0].sessionId).toBe('s1');
    expect(appended[0].ev).toMatchObject({
      type: 'turn/start',
      seq: 0,
      sessionId: 's1',
      data: { turn: 6 },
    });
  });

  it('内存计数器较大 ⇒ 用 `toolRoundCount + 1`（重启后 persisted 归零的兜底）', async () => {
    const { r } = await run({ persisted: 2, toolRoundCount: 7 });
    expect(r).toEqual({ started: true, turnNo: 8 });
  });

  it('两侧皆 0 ⇒ turn = 1', async () => {
    const { r } = await run({ persisted: 0, toolRoundCount: 0 });
    expect(r).toEqual({ started: true, turnNo: 1 });
  });

  it('追加失败 ⇒ **不**抛错，返回 `started:false`（下轮可重试）', async () => {
    const { r, appended } = await run({
      persisted: 1,
      toolRoundCount: 1,
      reject: true,
    });
    expect(r).toEqual({ started: false, turnNo: 0 });
    expect(appended).toHaveLength(1); // 已尝试写入
  });
});
