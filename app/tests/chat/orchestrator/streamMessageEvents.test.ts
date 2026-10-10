/**
 * P2-1c —— S4 事件持久化**单一 append 入口**契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S4 / §5；实现见
 * `src/chat/orchestrator/streamMessageEvents.ts`。
 *
 * 锁定两条不变量（拆分红线「行为零回归」）：
 * 1. **失败永不抛错**（CS03：事件落盘失败不阻断主流程）—— 与原各站点
 *    `try/catch { // @ignore-catch }` 等价；
 * 2. **透传**：成功时返回宿主结果的**原值**（不包装、不改写）；`sessionId` 按绑定值送达。
 */
import { describe, expect, it } from 'bun:test';

import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import {
  emitStreamEvent,
  makeEventEmitter,
  type StreamEventPayload,
} from '../../../src/chat/orchestrator/streamMessageEvents.js';

/** 最小宿主桩：只提供 `appendStreamEvent` */
function hostWith(
  impl: ChatOrchestratorHost['appendStreamEvent']
): ChatOrchestratorHost {
  return { appendStreamEvent: impl } as unknown as ChatOrchestratorHost;
}

/** 最小事件信封（本测试只关心 `type` 与送达路径，载荷形状由契约层保证） */
function ev(type: string): StreamEventPayload {
  return {
    type,
    seq: 0,
    time: 0,
    sessionId: 's1',
    data: {},
  } as unknown as StreamEventPayload;
}

describe('P2-1c S4 事件持久化 · 单一 append 入口', () => {
  it('成功 ⇒ 原样透传宿主结果（不包装/不改写）', async () => {
    const host = hostWith(async () => ({ ok: true, tailSeq: 42 }));
    const r = await emitStreamEvent(host, 's1', ev('turn/end'), {
      label: 'turn/end',
    });
    expect(r).toEqual({ ok: true, tailSeq: 42 });
  });

  it('宿主**抛错** ⇒ 本函数**不抛**，返回 `ok:false` + `threw:` 归因', async () => {
    const host = hostWith(async () => {
      throw new Error('disk full');
    });
    // 关键：不得向外抛（否则会打断流式主流程）
    const r = await emitStreamEvent(host, 's1', ev('system/error'), {
      label: 'system/error',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('threw:disk full');
    expect(r.tailSeq).toBe(0);
  });

  it('`makeEventEmitter`：按绑定 sessionId 送达，且载荷**原样**传给宿主（标签取 `event.type`）', async () => {
    const seen: Array<{ sid: string; type: string }> = [];
    const host = hostWith(async (sid: string, event: { type: string }) => {
      seen.push({ sid, type: event.type });
      return { ok: true, tailSeq: 1 };
    });
    const emit = makeEventEmitter(host, 'bound-session');
    await emit(ev('assistant/todo'));
    await emit(ev('assistant/status'), 'warn');
    expect(seen).toEqual([
      { sid: 'bound-session', type: 'assistant/todo' },
      { sid: 'bound-session', type: 'assistant/status' },
    ]);
  });
});
