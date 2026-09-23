// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 请求边界（P2-2，2026-09-23）—— `request/start` + 请求级 `metric/timing.requestId`
 *
 * 锁定四条硬约束：
 * 1. **配对键 = `request/start` 被分配的 seq**（= requestId），完成侧写同一值；
 * 2. **start 先于完成事件落盘**，且**同一次请求**的延迟条 / 用量条**共享同一 requestId**；
 * 3. **严禁借用 `callSeq`**（它归 `tool/result ↔ tool_call` 配对）—— 载荷内不得出现 callSeq；
 * 4. **拿不到就不写**（不估、不算、不填 0）；用量与耗时都拿不到 ⇒ **不产事件**。
 *
 * compaction 侧：`CompactionOrchestrator` 的摘要调用同样产 start + 至少一条同 requestId 的
 * 完成事件（经注入的 reporter）。
 */

import { describe, it, expect } from 'bun:test';
import type { LiriEvent } from '../../src/chat/types/events';
import {
  finishRequest,
  startRequest,
  type RequestEventAppender,
} from '../../src/chat/services/requestBoundary';
import { CompactionOrchestrator } from '../../src/context/compaction/CompactionOrchestrator';
import {
  COMPACTION_USER_PROMPT,
  parseCompactionSummary,
  renderCompactionSummary,
} from '../../src/context/compaction/StructuredCompactionPrompt';
import type { ChatMessage } from '../../src/ai/models/types';

/** 内存追加器：模拟 `EventLogStorage.append` 的 seq 原子分配（seq<=0 ⇒ 分配 tail+1） */
function makeAppender() {
  const written: LiriEvent[] = [];
  let tail = 0;
  const appender: RequestEventAppender = async (_sessionId, event) => {
    tail += 1;
    written.push({ ...event, seq: tail } as LiriEvent);
    return { ok: true, tailSeq: tail };
  };
  return {
    appender,
    written,
    tail: () => tail,
  };
}

describe('startRequest — request/start 落盘与 requestId 分配', () => {
  it('取 append 返回的 tailSeq 作为 requestId（= 该事件的 seq），并带上 model/reason/turn', async () => {
    const { appender, written } = makeAppender();
    const id = await startRequest(appender, 's1', {
      turn: 3,
      model: 'm-1',
      reason: 'chat',
    });

    expect(written).toHaveLength(1);
    expect(written[0].type).toBe('request/start');
    expect(written[0].seq).toBe(1);
    expect(id).toBe(1);
    expect(id).toBe(written[0].seq); // requestId 就是本事件的 seq
    expect(written[0].data).toEqual({
      turn: 3,
      model: 'm-1',
      reason: 'chat',
    });
  });

  it('缺省字段不写（不落 undefined），且**载荷内不得出现 callSeq**（不借用工具配对键）', async () => {
    const { appender, written } = makeAppender();
    await startRequest(appender, 's1');

    const data = written[0].data as Record<string, unknown>;
    expect(data).toEqual({});
    expect('callSeq' in data).toBe(false);
  });

  it('写入失败（ok:false）⇒ 返回 undefined（完成侧据此不写 requestId，不硬凑）', async () => {
    const appender: RequestEventAppender = async () => ({
      ok: false,
      reason: 'invalid-event',
      tailSeq: 7,
    });
    expect(await startRequest(appender, 's1', { model: 'm' })).toBeUndefined();
  });

  it('追加器抛异常 ⇒ 返回 undefined 且不抛出（请求边界不得阻断请求本身）', async () => {
    const appender: RequestEventAppender = async () => {
      throw new Error('disk full');
    };
    expect(await startRequest(appender, 's1')).toBeUndefined();
  });
});

describe('finishRequest — 请求级 metric/timing（用量/延迟，能拿才写）', () => {
  it('usage 可用 ⇒ 分桶字段 + requestId；无 duration ⇒ 不写 duration', async () => {
    const { appender, written } = makeAppender();
    await finishRequest(appender, 's1', 42, {
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    expect(written).toHaveLength(1);
    expect(written[0].type).toBe('metric/timing');
    expect(written[0].data).toEqual({
      stage: 'request',
      tokens: 120,
      inputTokens: 100,
      outputTokens: 20,
      requestId: 42,
    });
  });

  it('usage 缺失但耗时可用 ⇒ 只写 duration + requestId（不造 tokens）', async () => {
    const { appender, written } = makeAppender();
    await finishRequest(appender, 's1', 7, { durationMs: 1800 });

    expect(written[0].data).toEqual({
      stage: 'request',
      duration: 1800,
      requestId: 7,
    });
  });

  it('usage 与耗时**都拿不到** ⇒ 不产事件（不用空壳冒充"完成"）', async () => {
    const { appender, written } = makeAppender();
    expect(await finishRequest(appender, 's1', 7, {})).toBeNull();
    expect(
      await finishRequest(appender, 's1', 7, { usage: null })
    ).toBeNull();
    expect(written).toHaveLength(0);
  });

  it('拿不到 requestId ⇒ 事件不带该字段（不写 0 / 不写占位）', async () => {
    const { appender, written } = makeAppender();
    await finishRequest(appender, 's1', undefined, { durationMs: 5 });

    expect('requestId' in (written[0].data as Record<string, unknown>)).toBe(
      false
    );
  });

  it('追加器抛异常 ⇒ 返回 null 且不抛出', async () => {
    const appender: RequestEventAppender = async () => {
      throw new Error('boom');
    };
    expect(
      await finishRequest(appender, 's1', 1, { durationMs: 10 })
    ).toBeNull();
  });
});

describe('请求边界契约 — start 先于完成事件，且完成侧共享同一 requestId', () => {
  it('start → 延迟条 → 用量条：三条按序落盘，两条完成事件同 requestId', async () => {
    const { appender, written } = makeAppender();

    // ① 请求发出前
    const requestId = await startRequest(appender, 's1', {
      model: 'm-1',
      reason: 'chat',
    });
    expect(requestId).toBe(1);

    // ② 延迟条（生产端在 streamMessageFlow 的 ttfb/ttft 处写入；此处按同契约写入）
    await appender('s1', {
      type: 'metric/timing',
      seq: 0,
      time: Date.now(),
      sessionId: 's1',
      data: {
        stage: 'request',
        ttfb: 120,
        ttft: 150,
        requestId,
      },
    } as LiriEvent);

    // ③ 用量条（生产端在 ChatManager.recordChatResponseUsage 写入）
    await finishRequest(appender, 's1', requestId, {
      usage: { prompt_tokens: 900, completion_tokens: 100 },
    });

    expect(written.map((e) => e.type)).toEqual([
      'request/start',
      'metric/timing',
      'metric/timing',
    ]);
    // start 先落盘 ⇒ seq 最小
    expect(written[0].seq).toBeLessThan(written[1].seq);
    expect(written[0].seq).toBeLessThan(written[2].seq);

    const latency = written[1].data as { requestId?: number };
    const usage = written[2].data as { requestId?: number; tokens?: number };
    expect(latency.requestId).toBe(requestId);
    expect(usage.requestId).toBe(requestId); // 同一次请求 ⇒ 同一 requestId
    expect(usage.tokens).toBe(1000);
  });

  it('两个请求各自独立编号（同一编号序列内单调，不互相覆盖）', async () => {
    const { appender, written } = makeAppender();
    const first = await startRequest(appender, 's1', { reason: 'chat' });
    const second = await startRequest(appender, 's1', { reason: 'compaction' });

    expect(second).toBeGreaterThan(first as number);
    expect(
      written.map((e) => (e.data as { reason?: string }).reason)
    ).toEqual(['chat', 'compaction']);
  });
});

describe('compaction 请求边界 — 摘要调用同样有 start + 完成事件', () => {
  type Reporter = {
    start(
      sessionId: string,
      info: { model?: string }
    ): Promise<number | undefined>;
    finish(
      sessionId: string,
      requestId: number | undefined,
      info: { usage?: unknown; durationMs?: number }
    ): Promise<void>;
  };

  function makeReporter(nextId: number) {
    const started: Array<{ sessionId: string; model?: string }> = [];
    const finished: Array<{
      sessionId: string;
      requestId: number | undefined;
      info: { usage?: unknown; durationMs?: number };
    }> = [];
    const reporter: Reporter = {
      start: async (sessionId, info) => {
        started.push({ sessionId, model: info.model });
        return nextId;
      },
      finish: async (sessionId, requestId, info) => {
        finished.push({ sessionId, requestId, info });
      },
    };
    return { reporter, started, finished };
  }

  const procs = {
    COMPACTION_USER_PROMPT,
    parseCompactionSummary: (() => null) as typeof parseCompactionSummary,
    renderCompactionSummary,
  };

  const fold = (orch: CompactionOrchestrator) =>
    (
      orch as unknown as {
        _foldBatchSummary: (
          ai: { generate: Function },
          p: typeof procs,
          head: ChatMessage[],
          batch: ChatMessage[],
          ctx: { model: string; sessionId?: string },
          signal?: AbortSignal
        ) => Promise<string | null>;
      }
    )._foldBatchSummary.bind(orch);

  const batch: ChatMessage[] = [
    { role: 'user', content: '第1轮 ' + '你'.repeat(3000) },
  ];

  it('成功：start 带 reason=compaction / model，finish 带同一 requestId + usage + 真实耗时', async () => {
    const { reporter, started, finished } = makeReporter(88);
    // 注入 reporter（`_foldBatchSummary` 的 aiService 由调用方传入，与生产一致）
    const orch = new CompactionOrchestrator({ requestReporter: reporter });
    const ai = {
      generate: async () => ({
        content: '摘要',
        usage: { prompt_tokens: 500, completion_tokens: 50 },
      }),
    };

    const summary = await fold(orch)(ai, procs, [], batch, {
      model: 'm-compact',
      sessionId: 's1',
    });

    expect(summary).toBeTruthy();
    expect(started).toEqual([{ sessionId: 's1', model: 'm-compact' }]);
    expect(finished).toHaveLength(1);
    expect(finished[0].sessionId).toBe('s1');
    expect(finished[0].requestId).toBe(88); // 与 start 返回的标识一致
    expect(finished[0].info.usage).toEqual({
      prompt_tokens: 500,
      completion_tokens: 50,
    });
    expect(finished[0].info.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('失败（generate 抛错）：区间同样闭合（只带真实耗时，usage 未知不写）', async () => {
    const { reporter, finished } = makeReporter(9);
    const orch = new CompactionOrchestrator({ requestReporter: reporter });
    const ai = {
      generate: async () => {
        throw new Error('upstream 400');
      },
    };

    const summary = await fold(orch)(ai, procs, [], batch, {
      model: 'm-compact',
      sessionId: 's1',
    });

    expect(summary).toBeNull();
    expect(finished).toHaveLength(1);
    expect(finished[0].requestId).toBe(9);
    expect(finished[0].info.usage).toBeUndefined();
    expect(finished[0].info.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('未注入 reporter ⇒ 不产请求事件（如实缺省，不伪造），折叠逻辑照常', async () => {
    const orch = new CompactionOrchestrator();
    const ai = { generate: async () => ({ content: '摘要' }) };
    const summary = await fold(orch)(ai, procs, [], batch, {
      model: 'm-compact',
      sessionId: 's1',
    });
    expect(summary).toBeTruthy();
  });
});
