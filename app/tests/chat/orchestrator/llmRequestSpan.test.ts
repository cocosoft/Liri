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
 * TR-20：LLM 请求 OTel span 接线测试（2026-09-22）
 *
 * 断言（见 `.trae/specs/llm-request-otel-span.md` §5）：
 * - 成功路径：`startLLMRequestSpan` 恰一次、`endLLMRequestSpan` 恰一次（幂等守卫不重复）
 * - `ttftMs` 传**真 TTFT**（首个内容 chunk 时刻 − 请求起点），**非 TTFB**
 * - 中断路径：span **仍被 end**（不泄漏），且 `success: false` + `error` 有值
 *
 * 替身方式：直接替换 `getSessionTracing()` 单例的这两个方法 —— 不做模块级 mock，
 * 避免波及 `@modules/monitoring` 的 logger 等既有依赖（测试基座依赖它们）。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createTestHost } from './helpers';
import { runStreamMessage } from '../../../src/chat/orchestrator/streamMessageFlow.js';
import { getSessionTracing } from '../../../src/monitoring/tracing/SessionTracing.js';

interface SpanCall {
  name: 'start' | 'end' | 'interaction-start' | 'interaction-end';
  model?: string;
  prompt?: string;
  meta?: { success?: boolean; error?: string; ttftMs?: number };
}

/** 替换单例方法以记录调用；返回 `restore()` 用于复原 */
function spySessionTracing(): { calls: SpanCall[]; restore: () => void } {
  const tracing = getSessionTracing() as unknown as {
    startLLMRequestSpan: (model: string, opts?: unknown) => unknown;
    endLLMRequestSpan: (span: unknown, meta?: unknown) => void;
    startInteractionSpan: (userPrompt: string) => unknown;
    endInteractionSpan: () => void;
  };
  const original = {
    startLlm: tracing.startLLMRequestSpan,
    endLlm: tracing.endLLMRequestSpan,
    startInteraction: tracing.startInteractionSpan,
    endInteraction: tracing.endInteractionSpan,
  };
  const calls: SpanCall[] = [];

  tracing.startLLMRequestSpan = (model: string) => {
    calls.push({ name: 'start', model });
    return { fakeSpan: true };
  };
  tracing.endLLMRequestSpan = (_span: unknown, meta?: unknown) => {
    calls.push({ name: 'end', meta: (meta ?? {}) as SpanCall['meta'] });
  };
  tracing.startInteractionSpan = (userPrompt: string) => {
    calls.push({ name: 'interaction-start', prompt: userPrompt });
    return { fakeSpan: true };
  };
  tracing.endInteractionSpan = () => {
    calls.push({ name: 'interaction-end' });
  };

  return {
    calls,
    restore: () => {
      tracing.startLLMRequestSpan = original.startLlm;
      tracing.endLLMRequestSpan = original.endLlm;
      tracing.startInteractionSpan = original.startInteraction;
      tracing.endInteractionSpan = original.endInteraction;
    },
  };
}

/** 让流正常收尾（对齐既有用例：替换 finalize，避免触及真实持久化） */
function stubFinalize(host: ReturnType<typeof createTestHost>): void {
  (host as { _finalizeStreamMessage: unknown })._finalizeStreamMessage = async (
    _session: unknown,
    _content: string,
    accumulated: string
  ) => ({ content: accumulated }) as never;
}

let restoreFn: (() => void) | null = null;
afterEach(() => {
  restoreFn?.();
  restoreFn = null;
});

describe('TR-20：LLM 请求 span 接线', () => {
  it('成功路径 ⇒ start/end 各一次；ttftMs 为真 TTFT（首个内容 chunk）', async () => {
    const spy = spySessionTracing();
    restoreFn = spy.restore;

    const host = createTestHost({ llmChunks: [{ content: '你好' }] });
    stubFinalize(host);

    for await (const _chunk of runStreamMessage(host, '测试', {
      model: 'test-model',
    })) {
      void _chunk;
    }

    const starts = spy.calls.filter((c) => c.name === 'start');
    const ends = spy.calls.filter((c) => c.name === 'end');

    expect(starts).toHaveLength(1);
    expect(starts[0].model).toBe('test-model');
    // 幂等守卫：多条退出路径只 end 一次
    expect(ends).toHaveLength(1);
    expect(ends[0].meta?.success).toBe(true);
    // 真 TTFT：来自首个内容 chunk 时刻 ⇒ 有限非负数
    expect(typeof ends[0].meta?.ttftMs).toBe('number');
    expect(ends[0].meta?.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it('中断路径 ⇒ span 仍被 end（success=false 且 error 有值）', async () => {
    const spy = spySessionTracing();
    restoreFn = spy.restore;

    const host = createTestHost({
      llmChunks: [{ content: '前段' }, { content: '后段' }],
      llmOptions: { failAfter: 1 },
    });
    stubFinalize(host);

    for await (const _chunk of runStreamMessage(host, '测试', {
      model: 'test-model',
    })) {
      void _chunk;
    }

    const ends = spy.calls.filter((c) => c.name === 'end');
    expect(ends).toHaveLength(1);
    expect(ends[0].meta?.success).toBe(false);
    expect(ends[0].meta?.error).toBeTruthy();
  });
});

describe('TR-20：interaction 父 span 接线', () => {
  it('成功路径 ⇒ interaction start/end 各一次，prompt 为用户输入', async () => {
    const spy = spySessionTracing();
    restoreFn = spy.restore;

    const host = createTestHost({ llmChunks: [{ content: '你好' }] });
    stubFinalize(host);

    for await (const _chunk of runStreamMessage(host, '用户输入', {
      model: 'test-model',
    })) {
      void _chunk;
    }

    const starts = spy.calls.filter((c) => c.name === 'interaction-start');
    const ends = spy.calls.filter((c) => c.name === 'interaction-end');
    expect(starts).toHaveLength(1);
    expect(starts[0].prompt).toBe('用户输入');
    expect(ends).toHaveLength(1);
  });

  it('中断路径 ⇒ interaction 仍被 end（不泄漏）', async () => {
    const spy = spySessionTracing();
    restoreFn = spy.restore;

    const host = createTestHost({
      llmChunks: [{ content: '前段' }, { content: '后段' }],
      llmOptions: { failAfter: 1 },
    });
    stubFinalize(host);

    for await (const _chunk of runStreamMessage(host, '用户输入', {})) {
      void _chunk;
    }

    const ends = spy.calls.filter((c) => c.name === 'interaction-end');
    expect(ends).toHaveLength(1);
  });
});

describe('AsyncLocalStorage 在 async generator 中的上下文传播（机制验证）', () => {
  it('enterWith 设定后：跨 await、跨 yield 均可读到 store', async () => {
    const als = new AsyncLocalStorage<{ v: number }>();
    const seen: string[] = [];

    async function* gen(): AsyncGenerator<string> {
      als.enterWith({ v: 1 });
      seen.push(`enter:${als.getStore()?.v}`);
      await Promise.resolve();
      seen.push(`afterAwait:${als.getStore()?.v}`);
      yield 'a';
      seen.push(`afterYield1:${als.getStore()?.v}`);
      await Promise.resolve();
      yield 'b';
      seen.push(`afterYield2:${als.getStore()?.v}`);
    }

    for await (const _chunk of gen()) {
      void _chunk;
    }

    // **核心结论**：generator 内 `enterWith` 设的 store 跨 await / yield 均可见
    // ⇒ `interaction` 父 span 能被后续的 `startLLMRequestSpan` 读到
    expect(seen).toEqual([
      'enter:1',
      'afterAwait:1',
      'afterYield1:1',
      'afterYield2:1',
    ]);
  });

  it('enterWith 不自动恢复：generator 结束后调用方上下文即可见（记录既有语义）', async () => {
    const als = new AsyncLocalStorage<{ v: number }>();
    let afterGen: number | undefined = -999;

    async function* gen(): AsyncGenerator<string> {
      als.enterWith({ v: 7 });
      yield 'x';
      yield 'y';
    }

    expect(als.getStore()).toBeUndefined();
    for await (const _chunk of gen()) {
      void _chunk;
    }
    afterGen = als.getStore()?.v;

    // `enterWith` 与 `run` 不同 —— **不自动恢复**，故调用方此后也能读到该 store。
    // 这正是 `SessionTracing.endInteractionSpan` 需要显式 `enterWith(undefined)` 清除的原因
    // （`SessionTracing.ts:224`）；本用例把该语义**固化为断言**，避免后人误以为会自动清理。
    expect(afterGen).toBe(7);
  });
});
