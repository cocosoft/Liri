/**
 * 真机缺陷（2026-10-16）：「切走会话 ⇒ 长任务被中止，切回呈现**假空闲**」。
 *
 * 取证链（本机 18990，会话 `session_mva6u12hcfb812df09`）：运行中的长任务在切走会话时
 * 被客户端 `stopAndFlush() → stopMessage() → controller.abort()` 中止；后端事件日志停在
 * `seq=680 assistant/thinking`，**没有 `turn/end`** ⇒ 事件派生拿不到 `finishReason`
 * ⇒ 切回后前端既不显示"该回复已中断（任务被中止）"，也没有任何终态，用户看到进度冻结、
 * 无报错（Console 亦无 warn/error）的"卡住"。
 *
 * 不变量：`turn/start` ↔ `turn/end` 必须成对。崩溃恢复期已由 `EventLogRepair` 补闭合
 * （`finishReason: 'canceled'`）；本用例钉住"**客户端中止 / 异常穿透**时也补闭合"。
 *
 * 客户端无需改：`ChatMessage` 的中断判据本就是 `finishReason ∈ {canceled, abort}`。
 */
import { describe, expect, it } from 'bun:test';
import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import { createTestHost, createTestSession, sleep } from './helpers.js';
import type { LiriEvent } from '@modules/session/types/events.js';

const SESSION_ID = 'abort-turn-end';

/** 收集 `host.appendStreamEvent` 收到的事件（turn/start、turn/end 等） */
function collectEvents(): {
  events: LiriEvent[];
  hook: (
    sid: string,
    ev: LiriEvent
  ) => Promise<{ ok: boolean; tailSeq: number }>;
} {
  const events: LiriEvent[] = [];
  return {
    events,
    hook: async (_sid: string, ev: LiriEvent) => {
      events.push(ev);
      return { ok: true, tailSeq: events.length };
    },
  };
}

const turnEnds = (events: LiriEvent[]): LiriEvent[] =>
  events.filter((e) => e.type === 'turn/end');

describe('中止补齐 turn/end（切会话杀长任务后不再呈现假空闲）', () => {
  it('客户端中止（`.return()`，等价切走/断连）⇒ 补写恰好一条 `turn/end{canceled}`', async () => {
    const session = createTestSession({ id: SESSION_ID });
    const { events, hook } = collectEvents();
    const host = createTestHost({
      session,
      llmChunks: [{ content: 'a' }, { content: 'b' }, { content: 'c' }],
      appendStreamEvent: hook as never,
    });
    const orch = new ChatOrchestrator({ host });

    const gen = orch.streamMessage('hi', { sessionId: SESSION_ID });
    // 消费直到 `turn/start` 落盘 —— 中止必须发生在 turn **已开**之后，否则兜底不该补写
    // （若在此就断言不到 turn/start，本用例会红：避免"中止得太早"造成的假绿）
    for (let i = 0; i < 50; i++) {
      if (events.some((e) => e.type === 'turn/start')) break;
      const r = await gen.next();
      if (r.done) break;
    }
    expect(events.some((e) => e.type === 'turn/start')).toBe(true);

    // 模拟消费方中止：真实链路是 CoreAPIImpl 在 finally 里 `generator.return()`
    await gen.return(undefined as never);
    await sleep(50);

    const ends = turnEnds(events);
    expect(ends.length).toBe(1);
    expect((ends[0]!.data as { finishReason?: string }).finishReason).toBe(
      'canceled'
    );
  });

  it('正常结束 ⇒ 仍恰好一条 `turn/end`（兜底不得重复补写）', async () => {
    const session = createTestSession({ id: SESSION_ID });
    const { events, hook } = collectEvents();
    const host = createTestHost({
      session,
      llmChunks: [{ content: 'ok' }],
      appendStreamEvent: hook as never,
    });
    const orch = new ChatOrchestrator({ host });

    for await (const _chunk of orch.streamMessage('hi', {
      sessionId: SESSION_ID,
    })) {
      void _chunk;
    }

    const ends = turnEnds(events);
    expect(events.some((e) => e.type === 'turn/start')).toBe(true);
    expect(ends.length).toBe(1);
    expect((ends[0]!.data as { finishReason?: string }).finishReason).toBe(
      'stop'
    );
  });
});
