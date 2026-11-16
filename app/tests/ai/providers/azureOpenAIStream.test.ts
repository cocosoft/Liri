// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Azure OpenAI 流式 SSE 解析特征化（P3-2，2026-11-16）
//
// `chatStreamInternal` 的复杂度来自「SSE 逐行解析 + tool_calls 分片累积 + 终止原因映射」三段
// 挤在一个生成器里；判错只表现为「内容少一段 / 工具参数残缺 / 终止原因错」（不报错）
// ⇒ 外移前先按下表把每条 SSE 行为的可见结果钉住。
import { afterEach, describe, expect, it } from 'bun:test';
import { AzureOpenAIProvider } from '../../../src/ai/providers/AzureOpenAIProvider';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Captured = {
  url: string;
  init: RequestInit | undefined;
};

/** 用给定的 SSE 行构造 200 响应，并把 fetch 调用记录下来 */
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

/** 把整段 SSE 文本作为**单个** chunk 送入，消除分块边界带来的不确定性 */
function stubRaw(payload: string): Captured {
  const captured: Captured = { url: '', init: undefined };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.url = url;
    captured.init = init;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
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

function makeProvider(): AzureOpenAIProvider {
  return new AzureOpenAIProvider(
    {
      providerId: 'test-azure',
      displayName: 'Azure OpenAI',
      defaultBaseUrl: 'https://unused.example',
    },
    {
      apiKey: 'test-key',
      baseUrl: 'https://example.openai.azure.com',
      deployment: 'test-deployment',
    }
  );
}

type Consumed = {
  texts: string[];
  thinking: string[];
  response: Awaited<ReturnType<AzureOpenAIProvider['chat']>>;
};

/** 消费整条流，分别收集正文增量、思考增量与生成器返回值 */
async function consume(provider: AzureOpenAIProvider): Promise<Consumed> {
  const gen = provider.chatStream([{ role: 'user', content: 'hi' }], {
    model: 'test-deployment',
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

const data = (payload: unknown) => `data: ${JSON.stringify(payload)}`;

describe('Azure OpenAI 流式：请求构造', () => {
  it('URL 由 baseUrl + deployment + 默认 api-version 拼出，鉴权走 api-key 头', async () => {
    const captured = stubStream([data({ choices: [] }), 'data: [DONE]']);
    await consume(makeProvider());
    expect(captured.url).toBe(
      'https://example.openai.azure.com/openai/deployments/test-deployment/chat/completions?api-version=2024-02-15-preview'
    );
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers['api-key']).toBe('test-key');
    expect(captured.init?.method).toBe('POST');
  });
});

describe('Azure OpenAI 流式：正文与思考增量', () => {
  it('多段 delta.content 按序产出，并拼进最终响应', async () => {
    stubStream([
      data({ choices: [{ delta: { content: '你' } }] }),
      data({ choices: [{ delta: { content: '好' } }] }),
      'data: [DONE]',
    ]);
    const { texts, response } = await consume(makeProvider());
    expect(texts).toEqual(['你', '好']);
    expect(response.content).toBe('你好');
    expect(response.model).toBe('test-deployment');
    expect(response.stop_reason).toBe('stop');
    expect(response.tool_calls).toBeUndefined();
  });

  it('delta.reasoning_content 产出思考分片，不计入正文', async () => {
    stubStream([
      data({
        choices: [{ delta: { reasoning_content: '想一想' } }],
      }),
      data({ choices: [{ delta: { content: '答案' } }] }),
      'data: [DONE]',
    ]);
    const { texts, thinking, response } = await consume(makeProvider());
    expect(thinking).toEqual(['想一想']);
    expect(texts).toEqual(['答案']);
    expect(response.content).toBe('答案');
  });

  it('usage 取最后一处出现值', async () => {
    stubStream([
      data({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
      data({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
      'data: [DONE]',
    ]);
    const { response } = await consume(makeProvider());
    expect(response.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4 });
  });
});

describe('Azure OpenAI 流式：tool_calls 分片累积', () => {
  it('同一 index 的 id/name/arguments 跨片合并，按 index 升序收敛', async () => {
    stubStream([
      data({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'call_b',
                  function: { name: 'read_file', arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      }),
      data({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  function: { name: 'list_dir', arguments: '{}' },
                },
                { index: 1, function: { arguments: '"/tmp"}' } },
              ],
            },
          },
        ],
      }),
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]',
    ]);
    const { response } = await consume(makeProvider());
    expect(response.stop_reason).toBe('tool_calls');
    expect(response.tool_calls).toEqual([
      { id: 'call_a', name: 'list_dir', arguments: {} },
      { id: 'call_b', name: 'read_file', arguments: { path: '/tmp' } },
    ]);
    // 工具调用不产出正文
    expect(response.content).toBe('');
  });

  it('arguments 非法 JSON 时保留原文（不抛错）', async () => {
    stubStream([
      data({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_x',
                  function: { name: 'f', arguments: '{bad' },
                },
              ],
            },
          },
        ],
      }),
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]',
    ]);
    const { response } = await consume(makeProvider());
    expect(response.tool_calls).toEqual([
      { id: 'call_x', name: 'f', arguments: { _raw: '{bad' } },
    ]);
  });

  it('finish_reason=tool_calls 但无待收敛调用时仍为 stop', async () => {
    stubStream([
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]',
    ]);
    const { response } = await consume(makeProvider());
    expect(response.stop_reason).toBe('stop');
    expect(response.tool_calls).toBeUndefined();
  });
});

describe('Azure OpenAI 流式：终止原因映射', () => {
  it('finish_reason=length 映射为 max_tokens', async () => {
    stubStream([
      data({ choices: [{ delta: { content: 'a' }, finish_reason: 'length' }] }),
      'data: [DONE]',
    ]);
    const { response } = await consume(makeProvider());
    expect(response.stop_reason).toBe('max_tokens');
  });

  it('finish_reason=max_tokens 映射为 max_tokens', async () => {
    stubStream([
      data({
        choices: [{ delta: {}, finish_reason: 'max_tokens' }],
      }),
      'data: [DONE]',
    ]);
    const { response } = await consume(makeProvider());
    expect(response.stop_reason).toBe('max_tokens');
  });
});

describe('Azure OpenAI 流式：异常行与失败路径', () => {
  it('空行、注释行、非 data 前缀与坏 JSON 一律跳过', async () => {
    stubStream([
      '',
      ': keep-alive',
      'event: message',
      'data: {not json',
      data({ choices: [{ delta: { content: 'ok' } }] }),
      'data: [DONE]',
    ]);
    const { texts, response } = await consume(makeProvider());
    expect(texts).toEqual(['ok']);
    expect(response.content).toBe('ok');
  });

  it('[DONE] 之后的同批行不再处理（锁内层循环 break 语义）', async () => {
    // 单 chunk 送入，保证四行落在同一批 lines 里（分块边界会让 [DONE] 只结束当前批）
    stubRaw(
      [
        data({ choices: [{ delta: { content: 'a' } }] }),
        'data: [DONE]',
        data({ choices: [{ delta: { content: 'b' } }] }),
        '',
      ].join('\n')
    );
    const { texts } = await consume(makeProvider());
    expect(texts).toEqual(['a']);
  });

  it('非 2xx 抛 AppError，消息含状态码与响应体', async () => {
    globalThis.fetch = (async () =>
      new Response('deployment not found', {
        status: 404,
      })) as unknown as typeof fetch;
    await expect(consume(makeProvider())).rejects.toThrow(
      /Azure OpenAI stream error \(404\): deployment not found/
    );
  });

  it('响应无 body 时抛 AppError', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(consume(makeProvider())).rejects.toThrow(
      /Azure OpenAI stream: no response body/
    );
  });
});
