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
import { describe, it, expect, mock } from 'bun:test';

// ---- 模块级依赖 mock（Bun 自动提升到 import 之前生效）----
mock.module('@modules/monitoring', () => ({
  getLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    warning: () => {},
    error: () => {},
    trace: () => {},
  }),
}));
mock.module('@modules/monitoring/otel/OTelTracing.js', () => ({
  getOTelTracing: () => ({
    startSpan: () => ({}),
    recordError: () => {},
    endSpan: () => {},
  }),
}));
mock.module('@modules/error', () => ({ handleError: async () => {} }));
mock.module('@modules/config', () => ({
  configManager: { env: () => undefined },
}));
mock.module('@modules/constants/common.js', () => ({
  DEFAULT_MODEL_SENTINEL: 'auto',
}));
mock.module('@modules/chat', () => ({
  eventNotificationService: { on: () => {}, off: () => {} },
  createChatManager: () => ({}),
  computeUnifiedDiff: () => ({ diff: '', additions: 0, deletions: 0 }),
}));
// 2026-10-01（子批 C 第 19 条）：`dedupeMessagesToolCallBlocks` 已下沉 `utils/chatBlocks.ts`
// ⇒ mock 落点随之从 `@modules/chat` 移到本模块（原在 chat mock 内的那行已移除）。
mock.module('@modules/utils/chatBlocks', () => ({
  dedupeMessagesToolCallBlocks: (messages: unknown) => messages,
  dedupeToolCallBlocks: (blocks: unknown) => blocks,
}));
mock.module('@modules/session', () => ({
  MessageToEventMigrator: class {},
  EventLogStorage: class {},
  deriveMessagesFromEvents: () => [],
  ExecutionPhaseTracker: class {},
}));
mock.module('@modules/tools', () => ({
  getConverterEngine: () => ({}),
  FileTypeDetector: class {},
  globalToolManager: {},
  getToolManager: () => ({}),
}));
mock.module('@modules/core', () => ({ coordinator: {} }));
mock.module('@modules/permission', () => ({
  createPermissionManager: () => ({}),
}));
mock.module('@modules/ai', () => ({
  resolveModelRoute: async () => 'test-model',
  RouteKey: { CHAT: 'chat' },
  modelRouter: { resolve: () => null, resolveWithPhase: () => null },
  detectPhase: () => null,
  SmartRouter: class {},
  ToolAwareClient: class {},
  // P2-2（2026-09-26 修复）：桩必须忠实于真实契约。本文件测的是"**没有可用 Provider** ⇒
  // 延迟初始化失败 ⇒ 走 fallback 持久化"这条路径；此前写成 `providerRegistry: {}`，
  // 于是真实的 `ensureLLMClientInitialized()` 在 `getByModel()` 处就抛
  // `TypeError: providerRegistry.getByModel is not a function` ⇒ 把"预期中的失败"
  // 伪装成"代码缺陷"，在全量测试日志里长期留下误导性 warn（曾据此排查多轮）。
  // 补齐后失败落在**本意位置**：`未找到可用的 API Provider，请在 .env 中配置 API 密钥`。
  providerRegistry: { getByModel: () => undefined, list: () => [] },
  detectUnifiedProviders: () => [],
}));
mock.module('@modules/agent', () => ({
  getTitleGenerator: () => undefined,
}));

import { CoreAPIImpl, setCoreApiAppDeps } from '../CoreAPIImpl';
import type { ChatRequest, ChatResponse, ChatStreamChunk } from '../CoreAPI';
import type { ChatManager } from '@modules/chat';

// D-227（2026-10-02）：`chatStream` 经 `CoreApiAppDeps` 懒解析 app 能力（如 `router.resolveChat()`）
// ⇒ 本测试 setup 注册**最小 app 依赖桩**（`@modules/ai` 已在模块顶部 mock，取值与桩保持一致）。
setCoreApiAppDeps({
  chatManager: {},
  toolManager: {},
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
