// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Anthropic Messages 流式事件特征化（P3-2，2026-11-16）
//
// `chatStreamInternal` 的复杂度来自「SSE 行 → 事件类型 → 累积状态」的三层分派。
// 判错只表现为「思考/正文丢段」「tool_use 参数残缺」「停止原因或用量错」（不报错）
// ⇒ 外移事件分派前先按下表把每种事件的可见结果钉住。
import { afterEach, describe, expect, it } from 'bun:test';
import { AnthropicProvider } from '../../../src/ai/providers/AnthropicProvider';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Captured = { url: string; init: RequestInit | undefined };

/** 把给定 SSE 行按**单独 chunk** 送入，并记录 fetch 调用 */
function stubStream(lines: string[]): Captured {
  const captured: Captured = { url: '', init: undefined };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.url = url;
    captured.init = init;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines)
          controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
  return captured;
}

function makeProvider(): AnthropicProvider {
  return new AnthropicProvider({
    providerId: 'test-anthropic',
    displayName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.test',
    defaultModel: 'test-model',
  });
}

type Consumed = {
  texts: string[];
  thinking: string[];
  response: Awaited<ReturnType<AnthropicProvider['chat']>>;
};

async function consume(provider: AnthropicProvider): Promise<Consumed> {
  const gen = provider.chatStream([{ role: 'user', content: 'hi' }], {
    model: 'test-model',
  });
  const texts: string[] = [];
  const thinking: string[] = [];
  let next = await gen.next();
  while (!next.done) {
    const chunk = next.value;
    if (typeof chunk === 'string') texts.push(chunk);
    else thinking.push(chunk.content);
    next = await gen.next();
  }
  return { texts, thinking, response: next.value };
}

/** 组装一条带事件名的 SSE 记录 */
const event = (name: string, payload: unknown) => [
  `event: ${name}`,
  `data: ${JSON.stringify(payload)}`,
];

describe('Anthropic 流式：请求构造', () => {
  it('打到 /v1/messages，带 anthropic-version 头', async () => {
    const captured = stubStream([
      ...event('message_stop', { type: 'message_stop' }),
    ]);
    await consume(makeProvider());
    expect(captured.url).toBe('https://api.anthropic.test/v1/messages');
    expect(captured.init?.method).toBe('POST');
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});

describe('Anthropic 流式：正文与思考增量', () => {
  it('text_delta 逐段产出并拼进最终响应', async () => {
    stubStream([
      ...event('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '你' },
      }),
      ...event('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '好' },
      }),
      ...event('message_stop', { type: 'message_stop' }),
    ]);
    const { texts, response } = await consume(makeProvider());
    expect(texts).toEqual(['你', '好']);
    expect(response.content).toBe('你好');
    expect(response.stop_reason).toBe('stop');
    expect(response.tool_calls).toBeUndefined();
  });

  it('thinking_delta 产出思考分片，不计入正文', async () => {
    stubStream([
      ...event('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: '想一想' },
      }),
      ...event('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '答案' },
      }),
      ...event('message_stop', { type: 'message_stop' }),
    ]);
    const { texts, thinking, response } = await consume(makeProvider());
    expect(thinking).toEqual(['想一想']);
    expect(texts).toEqual(['答案']);
    expect(response.content).toBe('答案');
  });

  it('无任何事件时用量为零值兜底', async () => {
    stubStream([...event('message_stop', { type: 'message_stop' })]);
    const { response } = await consume(makeProvider());
    expect(response.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});

describe('Anthropic 流式：tool_use 累积', () => {
  it('content_block_start 建槽、input_json_delta 累积、tool_use 停止时收敛', async () => {
    stubStream([
      ...event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
      }),
      ...event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      }),
      ...event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"/tmp"}' },
      }),
      ...event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
      }),
      ...event('message_stop', { type: 'message_stop' }),
    ]);
    const { response } = await consume(makeProvider());
    expect(response.stop_reason).toBe('tool_calls');
    expect(response.tool_calls).toEqual([
      { id: 'toolu_1', name: 'read_file', arguments: { path: '/tmp' } },
    ]);
    expect(response.content).toBe('');
  });

  it('input_json_delta 无对应槽位时忽略（不建槽、不抛错）', async () => {
    stubStream([
      ...event('content_block_delta', {
        type: 'content_block_delta',
        index: 3,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      }),
      ...event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
      }),
    ]);
    const { response } = await consume(makeProvider());
    // 无待收敛调用 ⇒ 停止原因保持 stop
    expect(response.stop_reason).toBe('stop');
    expect(response.tool_calls).toBeUndefined();
  });

  it('参数非法 JSON 时保留原文', async () => {
    stubStream([
      ...event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_x', name: 'f' },
      }),
      ...event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{bad' },
      }),
      ...event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
      }),
    ]);
    const { response } = await consume(makeProvider());
    expect(response.tool_calls).toEqual([
      { id: 'toolu_x', name: 'f', arguments: { _raw: '{bad' } },
    ]);
  });
});

describe('Anthropic 流式：终止原因与用量', () => {
  it('stop_reason=max_tokens 映射为 max_tokens', async () => {
    stubStream([
      ...event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens' },
      }),
    ]);
    const { response } = await consume(makeProvider());
    expect(response.stop_reason).toBe('max_tokens');
  });

  it('message_delta.usage 映射为响应用量（含缓存读写）', async () => {
    stubStream([
      ...event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: {
          input_tokens: 11,
          output_tokens: 22,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 4,
        },
      }),
    ]);
    const { response } = await consume(makeProvider());
    expect(response.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 22,
      total_tokens: 33,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
    });
  });
});

describe('Anthropic 流式：异常行与失败路径', () => {
  it('非 data/event 前缀行与坏 JSON 一律跳过', async () => {
    stubStream([
      '',
      ': keep-alive',
      'data: {not json',
      'data: ',
      ...event('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'ok' },
      }),
    ]);
    const { texts, response } = await consume(makeProvider());
    expect(texts).toEqual(['ok']);
    expect(response.content).toBe('ok');
  });

  it('未知事件类型不影响后续处理', async () => {
    stubStream([
      ...event('ping', { type: 'ping' }),
      ...event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      ...event('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'after' },
      }),
    ]);
    const { texts } = await consume(makeProvider());
    expect(texts).toEqual(['after']);
  });

  it('非 2xx 抛 AppError（含状态码）', async () => {
    globalThis.fetch = (async () =>
      new Response('overloaded', { status: 529 })) as unknown as typeof fetch;
    await expect(consume(makeProvider())).rejects.toThrow(
      /Anthropic API error: 529/
    );
  });

  it('响应无 body 时抛 AppError', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(consume(makeProvider())).rejects.toThrow(
      /Anthropic stream: no response body/
    );
  });
});
