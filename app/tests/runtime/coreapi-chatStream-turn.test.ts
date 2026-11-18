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
 * `CoreAPIImpl.chatStream` 单轮编排的特征化测试（T3 复杂度清理前置，2026-11-17）
 *
 * 目的：把即将**原样外移**的四段行为钉住（外移前即为绿）：
 *  ① usage 累加 —— 多次 `onUsage` 回调累加成 done 块的 `usage`（主回复 + 工具轮次同口径）；
 *  ② 收尾 —— `finishReason` 取流末消息（非硬编码 'stop'）、返回值为整轮正文/会话/消息 id；
 *  ③ 失败 —— `error` 块携带真实 message、done 的 `finishReason='error'`，零产出时落 fallback；
 *  ④ 撞限 —— 带业务码的失败**抑制** fallback 落盘（D-l），且业务码随 error 块透出；
 *  ⑤ 占位标题 —— `TITLE_STAGE!=='false'` + 需要自动命名 ⇒ 调一次 `setPreliminaryTitle`。
 *
 * 手法：`new CoreAPIImpl({ chatManager })` 注入最小 chatManager，再覆写两个私有协作者
 * （`llmChatOps` / `sessionTitling`，TS `private` 仅编译期约束），与 `coreapi-session-meta.test.ts` 同款。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { configManager } from '@openliri/infra/config';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { CoreAPIImpl } from '../../src/runtime/api/CoreAPIImpl.js';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '../../src/runtime/api/CoreAPI.js';

interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface StreamOptions {
  onUsage?: (usage: UsageDelta) => void;
}

/** CoreAPIImpl 的私有协作者（覆盖用） */
interface CoreApiInternals {
  llmChatOps: {
    ensureLLMClientInitialized(): Promise<void>;
    resolveSmartModel(
      content: string,
      sessionId?: string,
      model?: string
    ): Promise<{ model: string; tier: string }>;
  };
  sessionTitling: {
    shouldAutoTitle(sessionId: string): boolean;
    setPreliminaryTitle(sessionId: string, title: string): Promise<void>;
    sanitizePlaceholderTitle(content: string): string;
    getExecutionPhaseTracker(sessionId: string): {
      buildDeliverableData(): unknown;
      reset(): void;
    };
    autoGenerateTitle(sessionId: string, content: string, reply: string): void;
  };
}

interface Harness {
  api: CoreAPIImpl;
  /** fallback 落盘记录（`chatManager.addMessage`） */
  added: unknown[];
  /** 占位标题写入记录 */
  titles: Array<[string, string]>;
}

function makeHarness(
  stream: (options: StreamOptions) => AsyncGenerator
): Harness {
  const added: unknown[] = [];
  const titles: Array<[string, string]> = [];
  const chatManager = {
    streamMessage: (_content: string, options: StreamOptions) =>
      stream(options),
    getMessageService: () => ({
      createAssistantMessage: (content: string) => ({
        id: 'fallback-1',
        role: 'assistant',
        content,
        metadata: {},
      }),
    }),
    addMessage: (_sid: string, msg: unknown) => {
      added.push(msg);
    },
    appendStreamEvent: async () => ({ ok: true, tailSeq: 0 }),
  };
  const api = new CoreAPIImpl({ chatManager: chatManager as never });
  const internals = api as unknown as CoreApiInternals;
  internals.llmChatOps = {
    ensureLLMClientInitialized: async () => {},
    resolveSmartModel: async () => ({ model: 'test-model', tier: 'standard' }),
  };
  internals.sessionTitling = {
    shouldAutoTitle: () => true,
    setPreliminaryTitle: async (sessionId, title) => {
      titles.push([sessionId, title]);
    },
    sanitizePlaceholderTitle: (content) => content,
    getExecutionPhaseTracker: () => ({
      buildDeliverableData: () => null,
      reset: () => {},
    }),
    autoGenerateTitle: () => {},
  };
  return { api, added, titles };
}

const request: ChatRequest = {
  content: 'hi',
  sessionId: 's1',
  messageId: 'm1',
} as ChatRequest;

/** 驱动整条流，收集 chunk 与生成器返回值 */
async function drive(api: CoreAPIImpl): Promise<{
  chunks: ChatStreamChunk[];
  result: Record<string, unknown>;
}> {
  const chunks: ChatStreamChunk[] = [];
  const gen = api.chatStream(request);
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value as ChatStreamChunk);
    step = await gen.next();
  }
  return { chunks, result: step.value as unknown as Record<string, unknown> };
}

const usageOnce = (u: UsageDelta) => (options: StreamOptions) =>
  options.onUsage?.(u);

const envSpy = spyOn(configManager, 'env').mockReturnValue('true');

afterEach(() => {
  envSpy.mockReturnValue('true');
});

describe('CoreAPIImpl.chatStream 单轮编排（特征化）', () => {
  it('① usage 累加 + 正常收尾（finishReason 取流末消息、返回整轮正文）+ 占位标题', async () => {
    const { api, titles } = makeHarness((options) => {
      usageOnce({
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
        estimatedCostUsd: 0.1,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
      })(options);
      return (async function* () {
        yield 'Hello';
        usageOnce({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })(options);
        yield ' world';
        return {
          id: 'am1',
          sessionId: 's1',
          content: 'Hello world',
          finishReason: 'stop',
          metadata: {},
        } as never;
      })();
    });

    const { chunks, result } = await drive(api);

    const types = chunks.map((c) => c.type);
    expect(types[0]).toBe('status');
    expect(chunks[0].content).toBe('AI is analyzing your request...');
    expect(types.slice(-2)).toEqual(['text', 'done']);
    expect(
      chunks.filter((c) => c.type === 'text').map((c) => c.content)
    ).toEqual(['Hello', ' world']);

    const done = chunks.at(-1)!;
    // 两次 onUsage 累加（含缓存 token）
    expect(done.usage).toEqual({
      inputTokens: 6,
      outputTokens: 3,
      totalTokens: 9,
      estimatedCostUsd: 0.1,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    });
    expect(done.finishReason).toBe('stop');

    expect(result).toEqual({
      content: 'Hello world',
      sessionId: 's1',
      messageId: 'am1',
      finishReason: 'stop',
    });
    // 占位标题：TITLE_STAGE!=='false' + shouldAutoTitle ⇒ 恰好一次
    expect(titles).toEqual([['s1', 'hi']]);
  });

  it('② 失败：error 块携带真实 message、done=error，零产出落 fallback', async () => {
    const { api, added } = makeHarness(() =>
      (async function* () {
        throw new Error('boom');
      })()
    );

    const { chunks } = await drive(api);

    const errorChunk = chunks.find((c) => c.type === 'error')!;
    expect(errorChunk.content).toBe('boom');
    expect(errorChunk.errorCode).toBeUndefined();
    expect(chunks.at(-1)!.finishReason).toBe('error');
    // 无业务码 + 零产出 ⇒ Write-Ahead 兜底一条 assistant
    expect(added).toHaveLength(1);
    expect(String((added[0] as { content?: string }).content)).toContain(
      '本次未能生成回复'
    );
  });

  it('③ 撞限：业务码随 error 块透出，且抑制 fallback 落盘（D-l）', async () => {
    const { api, added } = makeHarness(() =>
      (async function* () {
        throw new AppError(
          '日预算已用尽',
          ErrorCategory.RESOURCE,
          ErrorSeverity.MEDIUM,
          'DAILY_BUDGET_EXCEEDED'
        );
      })()
    );

    const { chunks } = await drive(api);

    const errorChunk = chunks.find((c) => c.type === 'error')!;
    expect(errorChunk.errorCode).toBe('DAILY_BUDGET_EXCEEDED');
    expect(added).toHaveLength(0);
  });
});
