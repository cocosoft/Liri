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
 * CoreAPIImpl.chatStream 失败路径单元测试
 *
 * 覆盖 2026-09-19 主 chat 空回复/中断 fallback 修复：
 *  - streamFailed && 无产出 → 按 Write-Ahead 持久化 assistant fallback 消息（复用前端 assistantMessageId）
 *  - 无 assistantMessageId → 使用自动生成 id 并回填最终 messageId
 *  - 有部分产出 → 不覆盖已产出内容（不持久化 fallback）
 */
import { afterAll, describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ⚠️ 本文件**禁止** `mock.module`（2026-10-10 去污染，L-23）：Bun 的模块 mock **进程级持久且不可
// 撤销**（`mock.restore()` 实测无效）⇒ 一个文件替换模块会**泄漏给其后所有测试文件**（实证：本文件
// 原先把 `@modules/config` 桩成恒 `undefined`，导致 A2A 侧车 5 例在全量 `bun test` 中失败，而隔离
// 运行全绿）。依赖一律经**既有 DI 缝**注入：
//   1. 构造参数 —— `new CoreAPIImpl({ chatManager })`（见下方 `setup()`）；
//   2. app 能力 —— `setCoreApiAppDeps({ … })`（见下，D-227 引入）。
// 门禁 `lint:no-module-mock` 会阻断新增用法。

import { CoreAPIImpl, setCoreApiAppDeps } from '../CoreAPIImpl';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../CoreAPI';
import type { ChatManager } from '@modules/chat';

// 数据目录隔离（口径同 `tests/setupIsolateAgentStore.ts` 的 N-46 先例）：去掉 `mock.module` 后各依赖
// 走**真实实现**，DB 层会在 `ProviderRegistry` / `AppModelConfigService` 首次使用时懒打开 —— 若不
// 重定向，本测试会读/写**生产库** `~/.pyapp/data/app.db`。
const ENV_DATA_DIR = 'LIRI_DATA_DIR';
const prevDataDir = process.env[ENV_DATA_DIR];
const tmpDir = mkdtempSync(join(tmpdir(), 'coreapi-chatstream-'));
process.env[ENV_DATA_DIR] = tmpDir;
afterAll(() => {
  // ⚠️ **必须还原**（2026-10-10）：与 `fetch`/模块 mock 同理 —— `bun test` 单进程按文件顺序执行，
  // 只在模块作用域改写 env 而不还原，会**污染其后所有测试文件**（实证：把后续 `VideoGenerateTool`
  // 的"模型未在 DB 中注册"失败引入，因为它拿到的是本文件的**空临时库**）。
  if (prevDataDir === undefined) delete process.env[ENV_DATA_DIR];
  else process.env[ENV_DATA_DIR] = prevDataDir;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch Windows 下 SQLite 句柄可能仍持有 `app.db`（EBUSY）⇒ 临时目录残留可接受
  }
});

// D-227（2026-10-02）：`chatStream` 经 `CoreApiAppDeps` 懒解析 app 能力（如 `router.resolveChat()`）
// ⇒ 本测试 setup 注册**最小 app 依赖桩**。
// ⚠️ 桩须**忠实于真实契约**（P2-2 教训）：`toolManager.getInner` 不可省 —— 缺它会让
// `ensureLLMClientInitialized()` 抛 `getInner is not a function`，把"预期的无 Provider 失败"
// 伪装成"代码缺陷"（本文件断言的是前者）。
setCoreApiAppDeps({
  chatManager: {},
  toolManager: { getInner: () => ({}) },
  converterEngine: {},
  fileTypeDetector: {},
  router: {
    resolveDefault: () => '',
    resolveWithPhase: () => null,
    resolveChat: async () => 'test-model',
  },
  getCheckpointService: () => ({}),
  createAutoCompactService: () => ({}),
  globalEmbeddingManager: {},
});

const FALLBACK_TEXT =
  '⚠️ 本次未能生成回复（任务被中断或模型无响应），请重发消息重试。';

interface PersistedMsg {
  id: string;
  role: string;
  content: string;
  sessionId: string;
}

function setup(options: { failAfterText?: string }) {
  const persisted: PersistedMsg[] = [];
  const fakeChatManager = {
    streamMessage: async function* (content: string) {
      if (options.failAfterText) yield options.failAfterText;
      throw new Error('boom: provider 不可达');
    },
    getMessageService: () => ({
      createAssistantMessage: (
        content: string,
        opts?: { id?: string; sessionId?: string }
      ) => ({
        id: opts?.id ?? 'auto-msg-1',
        role: 'assistant',
        content,
        sessionId: opts?.sessionId ?? '',
      }),
    }),
    addMessage: (sessionId: string, message: PersistedMsg) => {
      persisted.push({ ...message, sessionId });
    },
    getSessionManager: () => ({}),
    getSessions: () => [],
  } as unknown as ChatManager;

  const api = new CoreAPIImpl({ chatManager: fakeChatManager });
  return { api, persisted };
}

async function collect(
  gen: AsyncGenerator<ChatStreamChunk, ChatResponse, unknown>
): Promise<{ chunks: ChatStreamChunk[]; response: ChatResponse }> {
  const chunks: ChatStreamChunk[] = [];
  let result: IteratorResult<ChatStreamChunk, ChatResponse>;
  do {
    result = await gen.next();
    if (!result.done) chunks.push(result.value);
  } while (!result.done);
  return { chunks, response: result.value };
}

describe('CoreAPIImpl.chatStream — 失败 fallback 持久化', () => {
  it('失败且无产出时持久化 fallback 消息并复用前端透传的 assistantMessageId', async () => {
    const { api, persisted } = setup({});
    const request: ChatRequest = {
      sessionId: 'sess-1',
      content: '你好',
      model: 'test-model',
      assistantMessageId: 'frontend-msg-1',
    };

    const { chunks, response } = await collect(api.chatStream(request));

    // error chunk 正常下发
    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect((errorChunk as { content: string }).content).toContain('boom');
    // done chunk 标记 error
    expect(chunks.at(-1)?.type).toBe('done');

    // 恰好持久化一条 fallback 消息，复用前端 id，正文为 fallback 文案
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual({
      id: 'frontend-msg-1',
      role: 'assistant',
      content: FALLBACK_TEXT,
      sessionId: 'sess-1',
    });

    // 返回 messageId 回填为 fallback 消息 id（不再为空字符串）
    expect(response).toEqual({
      content: '',
      sessionId: 'sess-1',
      messageId: 'frontend-msg-1',
      finishReason: 'error',
    });
  });

  it('未透传 assistantMessageId 时使用自动生成 id 并回填', async () => {
    const { api, persisted } = setup({});
    const request: ChatRequest = {
      sessionId: 'sess-1',
      content: '你好',
      model: 'test-model',
    };

    const { response } = await collect(api.chatStream(request));

    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe('auto-msg-1');
    expect(response.messageId).toBe('auto-msg-1');
    expect(response.finishReason).toBe('error');
  });

  it('有部分产出时不覆盖已产出内容（不持久化 fallback）', async () => {
    const { api, persisted } = setup({ failAfterText: '部分内容' });
    const request: ChatRequest = {
      sessionId: 'sess-1',
      content: '你好',
      model: 'test-model',
      assistantMessageId: 'frontend-msg-1',
    };

    const { chunks, response } = await collect(api.chatStream(request));

    // 已产出文本 chunk 原样下发
    const textChunks = chunks.filter((c) => c.type === 'text');
    expect(textChunks.map((c) => (c as { content: string }).content)).toEqual([
      '部分内容',
    ]);
    // 不持久化 fallback（不覆盖已产出内容）
    expect(persisted).toHaveLength(0);
    // 返回已产出内容，messageId 保持空（无持久化消息）
    expect(response).toEqual({
      content: '部分内容',
      sessionId: 'sess-1',
      messageId: '',
      finishReason: 'error',
    });
  });
});
