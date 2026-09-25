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
 * Provider 失败包装的「预期中断」品牌回归（2026-09-25 §6.8；⑦ 流式 + 附带发现 14 非流式）
 *
 * **缺陷**：`isAbortReason()` 对 `Error` 走 `message.includes('aborted')`（**大小写敏感**）。
 * provider 把失败**包装**成 `AppError` 后，`name` 从 `AbortError` 变成 `AppError`、`message`
 * 变成 `"Xxx stream error: …"` / `"Xxx chat failed: …"` ⇒ 包装层**丢掉了中断身份**，被
 * `handleError` 当成真异常（severity HIGH → error 级日志 + 进 `recordError` 统计），
 * 而它其实来自"用户在流式中途停止/切换会话"或"压缩超时"这类**预期中断**。
 *
 * **修法**：包装时用 `markAsExpectedAbort()` 挂品牌位（显式标记，非字符串推断 —— CS02）。
 *
 * 每个用例三个断言：
 *   ① 预期中断 ⇒ 包装后的 `AppError` **仍**被 `isAbortReason()` 识别，且 severity 降为 LOW；
 *   ② **前提校验（防假绿）**：该包装文案**不含** `aborted` 字样 ⇒ ① 只可能由品牌位通过，
 *      若品牌位被删则本用例必红（而非被字符串兜底悄悄救活）；
 *   ③ 反向防线：非中止的真实错误 ⇒ 不得被标记，severity 仍为 HIGH。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { createSystemAbortReason } from '../../../src/query/ReActLoop.js';
import { isAbortReason } from '../../../src/error/abortReason.js';
import { ErrorSeverity, type AppError } from '../../../src/error/types.js';
import { OllamaProvider } from '../../../src/ai/providers/OllamaProvider.js';
import { GoogleProvider } from '../../../src/ai/providers/GoogleProvider.js';
import { VertexAIProvider } from '../../../src/ai/providers/VertexAIProvider.js';
import { OpenAIProvider } from '../../../src/ai/providers/OpenAIProvider.js';

/**
 * Vertex 在 fetch **之前**要取访问令牌；无凭据时会在 `try` 之外抛错，测不到 catch 里的品牌位。
 * 这里仅桩掉"取令牌"这一步，其余（fetch 入口 + catch）走真实实现。
 */
(VertexAIProvider.prototype as unknown as {
  getAccessToken: () => Promise<string>;
}).getAccessToken = async () => 'test-token';

/** 让下一次 fetch 以给定原因失败 */
function failFetch(reason: unknown): void {
  globalThis.fetch = (async () => {
    throw reason;
  }) as unknown as typeof fetch;
}

/** 消费生成器直到抛错，返回抛出的原因；若正常走完则返回 undefined */
async function captureError(
  gen: AsyncGenerator<unknown, unknown, unknown>
): Promise<unknown> {
  try {
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** 等 promise 落地并返回 rejection 原因；若正常 resolve 则返回 undefined */
async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** 断言：包装结果是「预期中断」（品牌位生效 + 降级 LOW + 文案不变） */
function assertExpectedAbort(err: unknown, prefix: string): void {
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).name).toBe('AppError');
  expect((err as Error).message.startsWith(`${prefix}: `)).toBe(true);
  // 前提校验（防假绿）：文案里**没有** `aborted` ⇒ 识别只能来自品牌位
  expect((err as Error).message.includes('aborted')).toBe(false);
  expect((err as AppError).severity).toBe(ErrorSeverity.LOW);
  expect(isAbortReason(err)).toBe(true);
}

/** 断言：包装结果是真实错误（未被误标为中断 + 保持 HIGH） */
function assertRealError(err: unknown, prefix: string): void {
  expect((err as Error).name).toBe('AppError');
  expect((err as Error).message.startsWith(`${prefix}: `)).toBe(true);
  expect((err as AppError).severity).toBe(ErrorSeverity.HIGH);
  expect(isAbortReason(err)).toBe(false);
}

const USER_TURN = [{ role: 'user' as const, content: 'hi' }];
const MODEL = { model: 'test-model' };

const makeOllama = (): OllamaProvider =>
  new OllamaProvider({
    providerId: 'test-ollama',
    displayName: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434',
  });

const makeGoogle = (): GoogleProvider =>
  new GoogleProvider({
    providerId: 'test-google',
    displayName: 'Google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  });

const makeVertex = (): VertexAIProvider =>
  new VertexAIProvider(
    {
      providerId: 'test-vertex',
      displayName: 'Vertex AI',
      defaultBaseUrl: 'https://us-central1-aiplatform.googleapis.com',
    },
    { projectId: 'test-project', region: 'us-central1' }
  );

const makeOpenAI = (): OpenAIProvider =>
  new OpenAIProvider({
    providerId: 'test-openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
  });

/** 流式（⑦）：包装点为 `chatStreamInternal` 的 catch */
const STREAM_CASES: Array<{
  label: string;
  prefix: string;
  run: () => AsyncGenerator<unknown, unknown, unknown>;
}> = [
  {
    label: 'OllamaProvider',
    prefix: 'Ollama stream error',
    run: () => makeOllama().chatStream(USER_TURN, MODEL),
  },
  {
    label: 'GoogleProvider',
    prefix: 'Gemini stream error',
    run: () => makeGoogle().chatStream(USER_TURN, MODEL),
  },
  {
    label: 'VertexAIProvider',
    prefix: 'Vertex AI stream error',
    run: () => makeVertex().chatStream(USER_TURN, MODEL),
  },
];

/** 非流式（附带发现 14）：包装点为 `chat()` 的 catch */
const NON_STREAM_CASES: Array<{
  label: string;
  prefix: string;
  run: () => Promise<unknown>;
}> = [
  {
    label: 'OllamaProvider',
    prefix: 'Ollama chat error',
    run: () => makeOllama().chat(USER_TURN, MODEL),
  },
  {
    label: 'GoogleProvider',
    prefix: 'Gemini chat failed',
    run: () => makeGoogle().chat(USER_TURN, MODEL),
  },
  {
    label: 'VertexAIProvider',
    prefix: 'Vertex AI chat failed',
    run: () => makeVertex().chat(USER_TURN, MODEL),
  },
  {
    label: 'OpenAIProvider',
    prefix: 'OpenAI chat failed',
    run: () => makeOpenAI().chat(USER_TURN, MODEL),
  },
];

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

describe('流式失败包装的预期中断品牌（⑦）', () => {
  for (const c of STREAM_CASES) {
    it(`${c.label}：预期中断 ⇒ 包装后仍被识别（品牌位）且降为 LOW`, async () => {
      failFetch(createSystemAbortReason());
      assertExpectedAbort(await captureError(c.run()), c.prefix);
    });

    it(`${c.label}：反向防线 ⇒ 非中止错误不得被标记，仍为 HIGH`, async () => {
      failFetch(new Error('connection reset by peer'));
      assertRealError(await captureError(c.run()), c.prefix);
    });
  }
});

describe('非流式 chat() 失败包装的预期中断品牌（附带发现 14）', () => {
  for (const c of NON_STREAM_CASES) {
    it(`${c.label}：预期中断 ⇒ 包装后仍被识别（品牌位）且降为 LOW`, async () => {
      failFetch(createSystemAbortReason());
      assertExpectedAbort(await captureRejection(c.run()), c.prefix);
    });

    it(`${c.label}：反向防线 ⇒ 非中止错误不得被标记，仍为 HIGH`, async () => {
      failFetch(new Error('connection reset by peer'));
      assertRealError(await captureRejection(c.run()), c.prefix);
    });
  }
});
