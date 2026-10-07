// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// D-245 自动化回归（2026-10-08）—— **压缩 token 同源对**（方案 B）+ **failed 不写 afterTokens**（方案 A）。
//
// 背景（真实历史轨迹取证，21 会话 / 47 条 `context/compaction`）：
// - `phase:'failed'` 曾写 `afterTokens`（入参为**未改动**的 `session.messages`，且与 `beforeTokens`
//   不同源）⇒ 同一事件里 `reason:'no_effect'`（文案"未降体积"）与"降幅 44%~79%"并存 ⇒ 前端展示
//   **并不存在**的"减少比例"。方案 A：failed 不写 `afterTokens`。
// - `phase:'done'` 曾混用 `snapshot.tokens`（`(尾截断输入+输出预估)×校准因子`）作前值、
//   `estimateMessagesTokens` 作后值 ⇒ **不同源** ⇒ 事件"减少比例"与状态块"节省 N%"**均失真**。
//   方案 B：两侧统一为 `estimateMessagesTokens`（与 `CompactionOrchestrator._runFullCompaction`
//   内部 `:798`/`:955` 同口径）。
//
// 本用例**驱动真实 emit 点**（`runStreamMessage` 大流程），把上述不变量钉死 —— 这正是此前
// "无既有点测口"所缺的覆盖面。

import { describe, it, expect, afterEach } from 'bun:test';
import { createTestHost } from './helpers';
import { runStreamMessage } from '../../../src/chat/orchestrator/streamMessageFlow.js';
import { estimateMessagesTokens } from '@modules/ai';
import { compactionOrchestrator } from '../../../src/context/compaction/CompactionOrchestrator';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';

/** 收集 appendStreamEvent 写入的事件（与 streamMessageFlow-invariants 同法） */
function collectEvents(
  host: ChatOrchestratorHost
): Array<{ type: string; data: Record<string, unknown> }> {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  (host as { appendStreamEvent: unknown }).appendStreamEvent = async (
    _sid: string,
    event: { type: string; data?: Record<string, unknown> }
  ) => {
    events.push({ type: event.type, data: event.data ?? {} });
    return { ok: true, tailSeq: events.length };
  };
  return events;
}

/** 压缩前消息（带 `lastEventSeq` ⇒ 可被识别为"被折叠"） */
const BEFORE = [
  { id: 'm1', role: 'user', content: 'A'.repeat(600), lastEventSeq: 1 },
  { id: 'm2', role: 'assistant', content: 'B'.repeat(600), lastEventSeq: 2 },
];

/** 压缩产物（无 `lastEventSeq` ⇒ 识别为 summary 新消息） */
const AFTER = [{ id: 'sum-1', role: 'user', content: '摘要'.repeat(20) }];

const singleton = compactionOrchestrator as unknown as {
  compact: (...args: unknown[]) => Promise<unknown>;
};

let restoreCompact: (() => void) | null = null;

afterEach(() => {
  restoreCompact?.();
  restoreCompact = null;
});

/** 建 host：checkBeforeRequest 首轮 trigger（其余 skip，避免二次压缩），压缩器返回给定结果 */
function makeHost(compactResult: unknown): ChatOrchestratorHost {
  const beforeMessages = [...BEFORE];
  let checkCalls = 0;
  const host = createTestHost({
    session: {
      id: 'sess-d245',
      messages: beforeMessages,
      metadata: {},
      state: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never,
    llmChunks: [],
    unifiedTracker: {
      checkBeforeRequest: async () => {
        checkCalls++;
        return checkCalls === 1
          ? {
              decision: 'trigger',
              beforeTokens: 999_999,
              snapshot: { tokens: 999_999, maxTokens: 1_000_000, ratio: 0.99 },
            }
          : {
              decision: 'skip',
              beforeTokens: 0,
              snapshot: { tokens: 0, maxTokens: 1_000_000, ratio: 0 },
            };
      },
      onStreamChunk: () => {},
      resetStreamTokens: () => {},
      startStreamingCheck: () => () => {},
      recordCompaction: () => {},
    } as never,
  });

  const original = singleton.compact;
  singleton.compact = async () => compactResult;
  restoreCompact = () => {
    singleton.compact = original;
  };

  return host;
}

/** 跑完一轮流式，返回收集到的事件与 status chunk */
async function run(compactResult: unknown): Promise<{
  events: Array<{ type: string; data: Record<string, unknown> }>;
  statuses: string[];
}> {
  const host = makeHost(compactResult);
  const events = collectEvents(host);
  const statuses: string[] = [];
  for await (const chunk of runStreamMessage(host, '测试', {})) {
    const c = chunk as { type?: string; statusType?: string; content?: string };
    if (c.type === 'status' && c.statusType === 'compaction' && c.content) {
      statuses.push(c.content);
    }
  }
  return { events, statuses };
}

const doneEvent = (
  events: Array<{ type: string; data: Record<string, unknown> }>
): Record<string, unknown> | undefined =>
  events.find((e) => e.type === 'context/compaction' && e.data.phase === 'done')
    ?.data;

describe('D-245 方案 B：done 分支压缩前后 token **同源**（同一估算器）', () => {
  it('beforeTokens/afterTokens 均等于 estimateMessagesTokens 在各自列表上的值，且前 > 后', async () => {
    const { events } = await run({ messages: AFTER, applied: true });
    const data = doneEvent(events);
    expect(data).toBeDefined();

    const expectedBefore = estimateMessagesTokens(BEFORE as never);
    const expectedAfter = estimateMessagesTokens(AFTER as never);
    // 同源：两侧都由 estimateMessagesTokens 产出（此前前值取 snapshot.tokens ⇒ 不同源）
    expect(data?.beforeTokens).toBe(expectedBefore);
    expect(data?.afterTokens).toBe(expectedAfter);
    expect(expectedBefore).toBeGreaterThan(expectedAfter);
    // 不再是"触发水位快照"（999_999 为 checkBeforeRequest 的返回值）
    expect(data?.beforeTokens).not.toBe(999_999);
  });

  it('用户可见状态块用**同一对数**（"节省 N%" 不再失真）', async () => {
    const { statuses } = await run({ messages: AFTER, applied: true });
    const expectedBefore = estimateMessagesTokens(BEFORE as never);
    const expectedAfter = estimateMessagesTokens(AFTER as never);
    const expectedPercent = Math.round(
      (1 - expectedAfter / expectedBefore) * 100
    );
    const compressedLine = statuses.find((s) => s.includes('上下文已压缩'));
    expect(compressedLine).toBeDefined();
    expect(compressedLine).toContain(
      `${expectedBefore.toLocaleString()} → ${expectedAfter.toLocaleString()}`
    );
    expect(compressedLine).toContain(`节省 ${expectedPercent}%`);
  });
});

describe('D-245 方案 A：failed 分支**不写** afterTokens（压缩未写回，无"压缩后"度量）', () => {
  it('phase:failed 事件只含 beforeTokens，不含 afterTokens 键', async () => {
    const { events } = await run({
      messages: BEFORE,
      applied: false,
      failure: {
        reason: 'exception',
        message: 'boom',
        probePhase: 'compaction:orchestrate',
        elapsedMs: 1,
      },
    });
    const data = events.find(
      (e) => e.type === 'context/compaction' && e.data.phase === 'failed'
    )?.data;
    expect(data).toBeDefined();
    expect(typeof data?.beforeTokens).toBe('number');
    expect(Object.prototype.hasOwnProperty.call(data, 'afterTokens')).toBe(
      false
    );
    expect(data?.reason).toBe('exception');
  });
});
