/**
 * TAOR 适配器：交互等待的资源回收回归（2026-10-19，源码排查报告 D4 / D5）。
 *
 * 修复前（`ChatManagerTAORAdapter.ts` 交互分支）：
 *  - **D4**：`setTimeout(…, 5min)` 的句柄未保存、race 结束后不 `clearTimeout`；
 *    `combinedSignal` 的 abort 监听也未移除 ⇒ 用户秒答后定时器仍挂 5 分钟；
 *  - **D5**：`pendingInteractions.set()` 与 `.delete()` 不在同一 `try` 作用域 ⇒
 *    期间任一回调（如 `onStreamChunk` 写前端通道）抛错时单槽永不释放 ⇒ 该会话此后
 *    所有交互工具都被「已有待处理交互」永久拒绝。
 *
 * 修复：`try/finally` 同时回收 ① 定时器 ② abort 监听 ③ `pendingInteractions` 单槽。
 */
import { describe, expect, it } from 'bun:test';

import {
  createChatManagerTAORDeps,
  type ChatManagerTAORContext,
} from '../../src/query/ChatManagerTAORAdapter.js';

const SID = 'sess-interaction';
const FIVE_MIN_MS = 5 * 60 * 1000;

interface MakeCtxOptions {
  onStreamChunk?: (chunk: unknown) => void;
}

function makeCtx(options: MakeCtxOptions = {}): ChatManagerTAORContext {
  return {
    sessionId: SID,
    sendModelRequest: async () => ({ content: '' }),
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: 'ok',
    }),
    persistMessage: () => {},
    toolDefinitions: [],
    toolRegistry: {
      getTool: () => ({ requiresUserInteraction: () => true }),
    },
    pendingInteractions: new Map(),
    onStreamChunk: options.onStreamChunk,
  } as unknown as ChatManagerTAORContext;
}

const toolCall = {
  id: 'tc-int-1',
  name: 'ask_user_question',
  arguments: { question: '继续吗？' },
};

describe('TAOR 交互等待：资源回收（D4/D5）', () => {
  it('D5：onStreamChunk 抛错时仍释放 pendingInteractions（不留永久死锁）', async () => {
    const ctx = makeCtx({
      onStreamChunk: () => {
        throw new Error('frontend channel down');
      },
    });
    const deps = createChatManagerTAORDeps(ctx);

    await expect(
      deps.executeTools(
        [toolCall],
        new AbortController().signal
      ) as Promise<unknown>
    ).rejects.toThrow('frontend channel down');

    expect(ctx.pendingInteractions?.has(SID)).toBe(false);
  });

  it('D4：用户作答后清除 5 分钟超时定时器', async () => {
    const ctx = makeCtx();
    const deps = createChatManagerTAORDeps(ctx);
    const signal = new AbortController().signal;

    // 仅捕获 5 分钟超时句柄（其余短定时器不参与断言）
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const timers = new Set<unknown>();
    const cleared = new Set<unknown>();
    globalThis.setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      const handle = realSetTimeout(fn, ms, ...args);
      if (ms === FIVE_MIN_MS) timers.add(handle);
      return handle;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((
      handle?: Parameters<typeof clearTimeout>[0]
    ) => {
      cleared.add(handle);
      return realClearTimeout(handle);
    }) as typeof clearTimeout;

    try {
      const running = deps.executeTools([toolCall], signal) as Promise<
        Array<{ error?: string }>
      >;
      // 等交互登记完成（`setTimeout(…, 0)` 不在捕获集内）
      await new Promise((resolve) => realSetTimeout(resolve, 0));

      const pending = ctx.pendingInteractions?.get(SID);
      expect(pending).toBeDefined();
      pending!.resolve(['yes']);

      const results = await running;
      expect(results[0]?.error).toBeUndefined();
      expect(ctx.pendingInteractions?.has(SID)).toBe(false);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }

    expect(timers.size).toBeGreaterThan(0);
    for (const handle of timers) expect(cleared.has(handle)).toBe(true);
  });

  it('S4：过期的挂起条目不会阻塞新的交互（TTL 自愈）', async () => {
    const ctx = makeCtx();
    // 预置一条已过期条目（模拟某条未知路径漏了释放）
    ctx.pendingInteractions!.set(SID, {
      questionId: 'q_stale',
      promise: Promise.resolve([]),
      resolve: () => {},
      expiresAt: Date.now() - 1,
    });
    const deps = createChatManagerTAORDeps(ctx);

    const running = deps.executeTools(
      [toolCall],
      new AbortController().signal
    ) as Promise<Array<{ error?: string }>>;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pending = ctx.pendingInteractions?.get(SID);
    expect(pending).toBeDefined();
    expect(pending!.questionId).not.toBe('q_stale');

    pending!.resolve(['yes']);
    const results = await running;
    expect(results[0]?.error).toBeUndefined();
  });
});
