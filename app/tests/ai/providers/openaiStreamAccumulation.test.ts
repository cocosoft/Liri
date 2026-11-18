// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`OpenAIProvider.chatStream` 的 **SSE 增量累积**行为（P3-2 外移前置，2026-11-17）
 *
 * 目的：在把 `chatStreamInternal` 里「tool_calls 分片累积 + finish_reason 收尾」与
 * 「流失败分类」两段原样外移到独立模块**之前**，先用测试钉住当前端到端行为：
 * 纯文本分片拼接、tool_calls 按 index 合并与乱序排定、截断时的半截调用上报、
 * 坏行跳过、usage 透传。外移后本文件必须**逐字不变、全绿**。
 *
 * 覆盖面界定（如实）：只覆盖 `baseUrl` 指向 `/chat/completions` 的 OpenAI 兼容流式路径；
 * 不覆盖非流式 `chat()`、不覆盖 transport 的请求体构造（`buildRequest`）。
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { OpenAIProvider } from '../../../src/ai/providers/OpenAIProvider.js';

const MODEL = { model: 'test-model' };
const USER_TURN = [{ role: 'user' as const, content: 'hi' }];

const realFetch = globalThis.fetch;

function makeProvider(): OpenAIProvider {
  return new OpenAIProvider({
    providerId: 'test-openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
  });
}

/**
 * 用给定 SSE 行拼一个 200 响应，并把它装到 `globalThis.fetch` 上。
 * `lines` 原样拼接（调用方负责保留 `\n`）。
 */
function stubSse(lines: string[]): void {
  const body = lines.join('');
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    )) as unknown as typeof fetch;
}

/** 消费整条流，返回 { chunks, final } */
async function drain(
  gen: AsyncGenerator<unknown, unknown, unknown>
): Promise<{ chunks: unknown[]; final: Record<string, unknown> }> {
  const chunks: unknown[] = [];
  let result = await gen.next();
  while (!result.done) {
    chunks.push(result.value);
    result = await gen.next();
  }
  return { chunks, final: result.value as Record<string, unknown> };
}

function jsonLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('OpenAIProvider.chatStream · SSE 增量累积（特征化）', () => {
  it('纯文本分片：逐片 yield 原始字符串，末尾汇总 content / stop_reason', async () => {
    stubSse([
      jsonLine({ choices: [{ delta: { content: 'He' } }] }),
      jsonLine({
        choices: [{ delta: { content: 'llo' }, finish_reason: 'stop' }],
      }),
      'data: [DONE]\n\n',
    ]);

    const { chunks, final } = await drain(
      makeProvider().chatStream(USER_TURN, MODEL)
    );

    expect(chunks).toEqual(['He', 'llo']);
    expect(final.content).toBe('Hello');
    expect(final.stop_reason).toBe('stop');
    expect(final.tool_calls).toBeUndefined();
    expect(final.partial_tool_calls).toBeUndefined();
  });

  it('tool_calls 分片：同 index 合并 id / name / 参数，按 index 升序落定', async () => {
    stubSse([
      // 乱序先来 index 1
      jsonLine({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'call_b',
                  function: { name: 'file_read', arguments: '{"path":"b' },
                },
              ],
            },
          },
        ],
      }),
      jsonLine({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  function: { name: 'file_read', arguments: '{"path":"a' },
                },
              ],
            },
          },
        ],
      }),
      // 续片只带参数（id / name 不得被空值覆盖）
      jsonLine({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '.txt"}' } },
                { index: 1, function: { arguments: '.txt"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      'data: [DONE]\n\n',
    ]);

    const { final } = await drain(makeProvider().chatStream(USER_TURN, MODEL));

    expect(final.stop_reason).toBe('tool_calls');
    expect(final.tool_calls).toEqual([
      { id: 'call_a', name: 'file_read', arguments: { path: 'a.txt' } },
      { id: 'call_b', name: 'file_read', arguments: { path: 'b.txt' } },
    ]);
    expect(final.partial_tool_calls).toBeUndefined();
  });

  it('参数非法 JSON：保留 _raw 原文，不抛错', async () => {
    stubSse([
      jsonLine({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_x',
                  function: { name: 'file_read', arguments: '{not-json' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      'data: [DONE]\n\n',
    ]);

    const { final } = await drain(makeProvider().chatStream(USER_TURN, MODEL));

    expect(final.tool_calls).toEqual([
      { id: 'call_x', name: 'file_read', arguments: { _raw: '{not-json' } },
    ]);
  });

  it('截断（finish_reason=length）：半截调用进 partial_tool_calls，绝不进 tool_calls', async () => {
    stubSse([
      jsonLine({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_trunc',
                  function: { name: 'file_write', arguments: '{"path":"b' },
                },
              ],
            },
          },
        ],
      }),
      jsonLine({ choices: [{ delta: {}, finish_reason: 'length' }] }),
      'data: [DONE]\n\n',
    ]);

    const { final } = await drain(makeProvider().chatStream(USER_TURN, MODEL));

    expect(final.stop_reason).toBe('max_tokens');
    expect(final.tool_calls).toBeUndefined();
    expect(final.partial_tool_calls).toEqual([
      {
        id: 'call_trunc',
        name: 'file_write',
        arguments: { _raw: '{"path":"b', _partial: true },
      },
    ]);
  });

  it('坏行（非法 JSON）跳过后续行照常累积；reasoning_content 走 thinking 分块', async () => {
    stubSse([
      'data: {oops-not-json\n\n',
      jsonLine({ choices: [{ delta: { reasoning_content: '想想' } }] }),
      jsonLine({
        choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
      }),
      'data: [DONE]\n\n',
    ]);

    const { chunks, final } = await drain(
      makeProvider().chatStream(USER_TURN, MODEL)
    );

    expect(chunks).toEqual([{ type: 'thinking', content: '想想' }, 'ok']);
    expect(final.content).toBe('ok');
  });

  it('usage 透传：流末 usage chunk 落到 final.usage', async () => {
    stubSse([
      jsonLine({
        choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }],
      }),
      jsonLine({
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      'data: [DONE]\n\n',
    ]);

    const { final } = await drain(makeProvider().chatStream(USER_TURN, MODEL));

    expect(final.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 1,
      total_tokens: 4,
    });
  });
});
