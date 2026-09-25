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
 * ChatOrchestrator.streamMessage —— turn 卡死看门狗**收尾**回归用例
 * （2026-09-25，P3-3「看门狗孤儿条目」修复）
 *
 * 缺陷：`watchdog.stop()` 原先只在 `while (!next.done)` **正常走完**后执行。
 * 两条路径会跳过它 ⇒ 定时器常驻，`timeoutMs`（默认 10 分钟）后对**已结束的 turn**
 * 触发 `onStall`（"尝试中断"误报 + 定时器/闭包泄漏）：
 *   ① `await gen.next()` 抛错（中止/异常从流中向上传播）；
 *   ② 消费方提前终止（客户端断线 → 生成器被 `.return()`）。
 *
 * 观察口径：`onStall` 的实现 `_handleTurnStall` 最终会调 `host.abortSessionStream(sessionId)`，
 * 故以其调用情况判定"看门狗是否仍在采样"——**在 turn 结束后等待远超阈值，不应有任何调用**。
 *
 * 说明：不使用 `mock.module`（进程级副作用，bun 无法恢复、会污染同 worker 其他用例），
 * 改走既有 `createTestHost()` + 真实 `streamMessageFlow`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { Message } from '../../../src/chat/types/message.js';
import { createTestHost, sleep } from './helpers.js';

/** 阈值/采样压到毫秒级，使"孤儿定时器"在用例时限内必然现身 */
const ENV_TIMEOUT = 'TURN_LIVENESS_TIMEOUT_MS';
const ENV_POLL = 'TURN_LIVENESS_POLL_MS';
const SHORT_TIMEOUT_MS = 60;
/**
 * 采样间隔**必须 ≥ MIN_POLL_MS（TurnLivenessWatchdog 内为 100）**：
 * 传入更小值会被判非法并回退默认 15s（`TURN_LIVENESS_POLL_MS 非法` warn），
 * 此时用例的观察窗口内根本不会 tick ⇒ 断言恒成立、失去判定力（本方曾踩此坑）。
 */
const SHORT_POLL_MS = 100;
/** 等待时长：超过"首个采样 tick（100ms）"⇒ 若定时器未被停止，必然已触发 onStall */
const OBSERVE_MS = 400;

let prevTimeout: string | undefined;
let prevPoll: string | undefined;

beforeEach(() => {
  prevTimeout = process.env[ENV_TIMEOUT];
  prevPoll = process.env[ENV_POLL];
  process.env[ENV_TIMEOUT] = String(SHORT_TIMEOUT_MS);
  process.env[ENV_POLL] = String(SHORT_POLL_MS);
});

afterEach(() => {
  if (prevTimeout === undefined) delete process.env[ENV_TIMEOUT];
  else process.env[ENV_TIMEOUT] = prevTimeout;
  if (prevPoll === undefined) delete process.env[ENV_POLL];
  else process.env[ENV_POLL] = prevPoll;
});

function buildOrchestrator(): {
  orch: ChatOrchestrator;
  stalled: string[];
} {
  const stalled: string[] = [];
  const host = createTestHost({
    llmChunks: [{ content: 'hello' }],
    abortSessionStream: (sessionId: string) => {
      stalled.push(sessionId);
    },
  });
  return { orch: new ChatOrchestrator({ host }), stalled };
}

describe('ChatOrchestrator.streamMessage — 看门狗收尾（防孤儿条目）', () => {
  it('消费方提前终止（客户端断线 ⇒ 生成器 return）后必须停止采样', async () => {
    const { orch, stalled } = buildOrchestrator();
    const gen = orch.streamMessage('hi', {});

    const first = await gen.next();
    expect(first.done).toBe(false);
    // 前提校验：首个 chunk 必须携带 sessionId，否则 onStall 不会走到
    // abortSessionStream（用例将失去判定口径）
    expect((first.value as { sessionId?: string }).sessionId).toBeTruthy();

    // 模拟消费方提前终止：等价 `for await` 中 break → 迭代器 .return()
    await gen.return(undefined as unknown as Message);

    await sleep(OBSERVE_MS);
    expect(stalled).toEqual([]);
  });

  it('正常走完（消费到 done）后同样不再触发（防回归）', async () => {
    const { orch, stalled } = buildOrchestrator();
    const gen = orch.streamMessage('hi', {});

    let guard = 0;
    let next = await gen.next();
    while (!next.done && guard++ < 200) {
      next = await gen.next();
    }
    expect(next.done).toBe(true);

    await sleep(OBSERVE_MS);
    expect(stalled).toEqual([]);
  });
});
