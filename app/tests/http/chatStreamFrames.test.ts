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
 * `POST /v1/chat/completions`（stream=true）的 **SSE 帧格式**特征化测试（T3 复杂度清理前置，2026-11-17）
 *
 * 目的：把 `handleStreamingChat` 里"chunk → SSE 数据帧"的既有线格式钉住，供后续把该 switch
 * 段**原样外移**（圈复杂度 93 → 阈值内）时对照。断言只看 `res.write` 的字节流：
 *  ① 文本 / 思考 / 工具调用 / 交付物四类帧的字段集合与顺序语义；
 *  ② `done` 携带 usage ⇒ 先 `usage` 帧、再 `[DONE]`；无 usage ⇒ 直接 `done` 帧（无 `__pyapp_type`）；
 *  ③ 末条消息不是 user ⇒ 400（不进 SSE）。
 *
 * 手法与 `chatStreamExecutionHandler.test.ts` 一致：先 `spyOn` 模块导出、再动态导入 handler
 * （静态 import 会被 ESM 提升，早于 spy 生效）。
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import type http from 'http';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '../../src/runtime/api/CoreAPI';

const SESSION_ID = 'sse-session';

/** 本次 `chatStream` 的产出（各用例按需替换） */
let chatStreamImpl: () => AsyncGenerator<ChatStreamChunk, unknown, unknown>;

const eventBusStub = { on: () => {}, off: () => {} };
const chatManagerStub = {
  getEventNotificationService: () => eventBusStub,
  isSessionStreaming: () => false,
  abortSessionStream: () => {},
};

const coreAPIStub = {
  chatManager: chatManagerStub,
  getChatManager: () => chatManagerStub,
  chat: async () => ({ content: '' }),
  chatStream: () => chatStreamImpl(),
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

const { handleChatCompletions } =
  await import('../../src/infrastructure/http/handlers/chat-handlers');

// ─── 最小 res / ctx ──────────────────────────────────────

interface ResHarness {
  res: http.ServerResponse;
  chunks: string[];
  writeHeadStatus: number;
  emitClose: () => void;
}

function makeRes(): ResHarness {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const out = { writeHeadStatus: 0 };
  const res = {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    socket: undefined,
    flush: () => {},
    writeHead: (code: number) => {
      out.writeHeadStatus = code;
      return res;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: (chunk?: string) => {
      if (chunk) chunks.push(chunk);
      res.writableEnded = true;
      return res;
    },
    on: (event: string, cb: () => void) => {
      if (event === 'close') closeHandlers.push(cb);
      return res;
    },
  };
  return {
    res: res as unknown as http.ServerResponse,
    chunks,
    get writeHeadStatus() {
      return out.writeHeadStatus;
    },
    emitClose: () => {
      for (const h of closeHandlers) h();
    },
  };
}

function makeCtx(body: Record<string, unknown>): HandlerCtx {
  return {
    readRequestBody: async () => JSON.stringify(body),
    sendError: () => {},
  } as unknown as HandlerCtx;
}

const body = {
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
  session_id: SESSION_ID,
  message_id: 'm1',
};

async function run(): Promise<ResHarness> {
  const harness = makeRes();
  try {
    await handleChatCompletions(
      makeCtx(body),
      {} as http.IncomingMessage,
      harness.res
    );
  } finally {
    harness.emitClose();
  }
  return harness;
}

/** 把累积字节切成 `data: …` 帧；`[DONE]` 原样保留 */
function frames(chunks: string[]): string[] {
  return chunks
    .join('')
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => f.replace(/^data: /, ''));
}

function jsonFrames(chunks: string[]): Array<Record<string, unknown>> {
  return frames(chunks)
    .filter((f) => f !== '[DONE]')
    .map((f) => JSON.parse(f) as Record<string, unknown>);
}

beforeEach(() => {
  chatStreamImpl = defaultStream;
});

afterEach(() => {
  chatStreamImpl = defaultStream;
});

/** 默认流：文本 + 思考 + 工具调用 + 交付物 + done（带 usage） */
function defaultStream() {
  return (async function* () {
    yield {
      type: 'text',
      content: 'hi',
      sessionId: SESSION_ID,
      messageId: 'am1',
    } as unknown as ChatStreamChunk;
    yield {
      type: 'thinking',
      content: '考虑中',
      statusType: 'thinking',
    } as unknown as ChatStreamChunk;
    yield {
      type: 'tool_call',
      toolCall: { id: 'tc1', name: 'read_file', arguments: { path: 'a' } },
    } as unknown as ChatStreamChunk;
    yield {
      type: 'deliverable',
      deliverableData: { id: 'd1' },
      content: '',
    } as unknown as ChatStreamChunk;
    yield {
      type: 'done',
      finishReason: 'length',
      terminationReason: 'max_tokens',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.01,
      },
    } as unknown as ChatStreamChunk;
    return { content: 'hi' };
  })();
}

// ─── 特征化断言 ──────────────────────────────────────────

describe('handleStreamingChat 的 SSE 帧格式（特征化）', () => {
  it('① 文本 / 思考 / 工具调用 / 交付物 四类帧的线格式不变', async () => {
    const harness = await run();
    const parsed = jsonFrames(harness.chunks);

    const role = parsed[0];
    expect(role.object).toBe('chat.completion.chunk');
    expect(role.choices).toEqual([
      { index: 0, delta: { role: 'assistant' }, finish_reason: null },
    ]);

    const status = parsed[1];
    expect(status.__pyapp_type).toBe('status');
    expect(status.__pyapp_status_type).toBe('ai_thinking');

    const text = parsed.find(
      (f) =>
        (f.choices as Array<{ delta?: { content?: string } }>)[0]?.delta
          ?.content === 'hi' && !f.__pyapp_type
    );
    expect(text?.__pyapp_message_id).toBe('am1');

    const thinking = parsed.find((f) => f.__pyapp_type === 'thinking');
    expect(thinking?.__pyapp_status_type).toBe('thinking');

    const toolCall = parsed.find((f) => f.__pyapp_type === 'tool_call');
    expect(toolCall?.__pyapp_tool_status).toBeDefined();
    expect(
      (toolCall?.choices as Array<{ delta?: { tool_calls?: unknown[] } }>)[0]
        ?.delta?.tool_calls
    ).toEqual([
      {
        id: 'tc1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a"}' },
      },
    ]);

    const deliverable = parsed.find((f) => f.__pyapp_type === 'deliverable');
    expect(deliverable?.__pyapp_deliverable).toEqual({ id: 'd1' });
  });

  it('② done 带 usage ⇒ 先 usage 帧（含 finish_reason/终止判定）再 [DONE]', async () => {
    const harness = await run();
    const parsed = jsonFrames(harness.chunks);

    const usage = parsed.find((f) => f.__pyapp_type === 'usage');
    expect(usage?.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      estimated_cost_usd: 0.01,
      cache_read_input_tokens: undefined,
      cache_creation_input_tokens: undefined,
    });
    expect(usage?.__pyapp_termination_reason).toBe('max_tokens');
    expect(
      (usage?.choices as Array<{ finish_reason?: string }>)[0]?.finish_reason
    ).toBe('length');

    expect(frames(harness.chunks).at(-1)).toBe('[DONE]');
  });

  it('③ done 无 usage ⇒ 直接 done 帧（无 __pyapp_type）；末条非 user ⇒ 400', async () => {
    chatStreamImpl = () =>
      (async function* () {
        yield {
          type: 'done',
          finishReason: 'stop',
        } as unknown as ChatStreamChunk;
        return { content: '' };
      })();

    const harness = await run();
    const parsed = jsonFrames(harness.chunks);
    const done = parsed.at(-1);
    expect(done?.__pyapp_type).toBeUndefined();
    expect(
      (done?.choices as Array<{ finish_reason?: string }>)[0]?.finish_reason
    ).toBe('stop');
    expect(frames(harness.chunks).at(-1)).toBe('[DONE]');

    // 末条消息不是 user ⇒ 400，且不进 SSE（writeHead 400 来自非流式/校验分支）
    const bad = makeRes();
    await handleChatCompletions(
      makeCtx({
        ...body,
        messages: [{ role: 'assistant', content: 'hi' }],
      }),
      {} as http.IncomingMessage,
      bad.res
    );
    expect(bad.writeHeadStatus).toBe(400);
  });
});
