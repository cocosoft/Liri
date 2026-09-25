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
 * 内层生成器关闭 —— 回归用例（2026-09-25，spec §6.7）
 *
 * 缺陷（修复前，已取证）：`ChatOrchestrator.streamMessage` 手工驱动内层
 * `runStreamMessage` 生成器，其 `finally` 原先**只做 `watchdog.stop()`**、
 * **不关内层** ⇒ 消费方提前 `.return()`（客户端断线）或异常从 `await gen.next()`
 * 抛出时，内层会被**遗弃在挂起点**，其 `finally`——即**唯一**的 `mutex.release()`
 * 点（同处还有 `endInteractionSpan()` / 兜底检查点落盘 / `endSpan(streamSpan)`）
 * ——**永不执行**。Bun 实测：遗弃的 async generator 即使 3× `Bun.gc(true)`
 * 也不补跑 `finally`（无 GC 兜底）。
 *
 * 修复：`ChatOrchestrator.streamMessage` 与 `CoreAPIImpl.chatStream` 的 `finally`
 * 各补一笔 `void gen.return(...).catch(() => {})`，与 `chat-handlers` 的
 * `generator.return()` 形成三层闭环。
 *
 * 观察口径：向 host 注入带探针的 `mutex`（记录 acquire/release），
 * 先推进到 `acquire` 之后再关外层；**release 必须且只能发生一次**。
 *
 * 说明：不使用 `mock.module`（进程级副作用、会污染同 worker 其他用例）。
 */
import { describe, it, expect } from 'bun:test';
import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatSession } from '../../../src/chat/types/session.js';
import type { Message } from '../../../src/chat/types/message.js';
import { createTestHost, createTestSession, sleep } from './helpers.js';

/** 装配带 mutex 探针的 host（acquire/release 事件写入 events） */
function buildHostWithMutexProbe(events: string[]) {
  const session: ChatSession = createTestSession();
  const host = createTestHost({
    session,
    llmChunks: [{ content: 'hello' }],
    // 注入带探针的 mutex / span（其余字段与 helpers 的默认端口等价）
    _prepareStreamSession: (async () => ({
      content: '',
      session,
      streamAbortController: new AbortController(),
      streamingCheckpoint: {
        onToolCompleted: async () => {},
        restore: async () => null,
        restoreStepIndex: () => {},
      },
      mutex: {
        acquire: async () => {
          events.push('acquire');
        },
        release: () => {
          events.push('release');
        },
      },
      userMessage: {} as Message,
      streamSpan: {
        addEvent: () => {},
        end: () => {},
        recordException: () => {},
        setAttribute: () => {},
        setStatus: () => {},
      },
    })) as never,
  });
  return { host, session };
}

const countOf = (events: string[], name: string): number =>
  events.filter((e) => e === name).length;

describe('ChatOrchestrator.streamMessage — 内层生成器必须被关闭', () => {
  it('正常消费到 done ⇒ release 恰好一次', async () => {
    const events: string[] = [];
    const { host } = buildHostWithMutexProbe(events);
    const orch = new ChatOrchestrator({ host });

    const gen = orch.streamMessage('hi', {});
    let guard = 0;
    let next = await gen.next();
    while (!next.done && guard++ < 200) {
      next = await gen.next();
    }
    expect(next.done).toBe(true);

    expect(countOf(events, 'acquire')).toBe(1);
    expect(countOf(events, 'release')).toBe(1);
  });

  it('消费方提前 return（客户端断线）⇒ 内层 finally 仍执行，release 恰好一次', async () => {
    const events: string[] = [];
    const { host } = buildHostWithMutexProbe(events);
    const orch = new ChatOrchestrator({ host });

    const gen = orch.streamMessage('hi', {});

    // 先推进到"已获取互斥锁"之后，否则 mutexHeld=false，断言无意义
    let advanced = 0;
    let next = await gen.next();
    while (!next.done && !events.includes('acquire') && advanced < 60) {
      advanced++;
      next = await gen.next();
    }
    expect(events).toContain('acquire'); // 前提：确实进入过 acquire

    // 模拟消费方提前终止（客户端断线 / break）：仅关外层
    await gen.return(undefined as unknown as Message);
    await sleep(300);

    expect(countOf(events, 'release')).toBe(1);
  });
});
