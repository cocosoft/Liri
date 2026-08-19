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
 * OllamaProvider 单元测试（bun:test + mock global fetch）
 *
 * 覆盖「模型不支持工具调用」降级链路（2026-08-19 修复）：
 *   1. 带 tools 请求被 Ollama 以 400 "does not support tools" 拒绝时，
 *      自动降级为无 tools 重试一次并成功；
 *   2. 缓存模型不支持工具后，后续请求直接不带 tools（单次调用）；
 *   3. 非工具原因 400 时，错误携带响应 body 真实信息（原实现仅 statusText 掩盖详情）；
 *   4. 非流式 chat 同样走降级链路。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { ToolDefinition } from '../../../src/ai/models/types';
import { OllamaProvider } from '../../../src/ai/providers/OllamaProvider.js';

/** 记录一次 fetch 调用 */
interface FetchCall {
  url: string;
  init?: RequestInit;
}

let calls: FetchCall[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Ollama /api/chat 流式响应：每行一个 JSON（NDJSON） */
function streamResponse(lines: unknown[]): Response {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 设置 fetch mock：自动记录调用，测试通过 handler 定制响应 */
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

function makeProvider(): OllamaProvider {
  return new OllamaProvider({
    providerId: 'test-ollama',
    displayName: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434',
  });
}

/** 收集流式生成器的所有文本 chunk 与最终 return 值 */
async function collect(
  gen: AsyncGenerator<
    string | { type: string; content?: string },
    unknown,
    unknown
  >
): Promise<{ chunks: string[]; result: unknown }> {
  const chunks: string[] = [];
  let r = await gen.next();
  while (!r.done) {
    if (typeof r.value === 'string') chunks.push(r.value);
    r = await gen.next();
  }
  return { chunks, result: r.value };
}

const weatherTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询天气',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

describe('OllamaProvider · 模型不支持工具调用降级', () => {
  it('流式：400 "does not support tools" 时降级为无 tools 重试并成功', async () => {
    let n = 0;
    mockFetch((_url, init) => {
      n++;
      if (n === 1) {
        return jsonResponse(
          {
            error:
              'registry.ollama.ai/library/qwen3.6-27b:latest does not support tools',
          },
          400
        );
      }
      return streamResponse([
        {
          model: 'qwen3.6-27b',
          message: { role: 'assistant', content: '你好' },
          done: false,
        },
        {
          model: 'qwen3.6-27b',
          message: { role: 'assistant', content: '' },
          done: true,
          prompt_eval_count: 5,
          eval_count: 2,
        },
      ]);
    });

    const provider = makeProvider();
    const { chunks, result } = await collect(
      provider.chatStream([{ role: 'user', content: 'hi' }], {
        model: 'qwen3.6-27b',
        tools: [weatherTool],
      })
    );

    expect(n).toBe(2);
    expect(chunks.join('')).toBe('你好');
    expect((result as { model?: string }).model).toBe('qwen3.6-27b');
    const secondBody = JSON.parse(calls[1].init?.body as string);
    expect(secondBody.tools).toBeUndefined();
  });

  it('缓存工具不支持后，后续请求直接不带 tools（单次调用）', async () => {
    const provider = makeProvider();
    let n = 0;
    mockFetch((_url, init) => {
      n++;
      if (n === 1) {
        return jsonResponse(
          { error: 'qwen3.6-27b does not support tools' },
          400
        );
      }
      return streamResponse([
        {
          model: 'qwen3.6-27b',
          message: { role: 'assistant', content: 'ok' },
          done: false,
        },
        {
          model: 'qwen3.6-27b',
          message: { role: 'assistant', content: '' },
          done: true,
        },
      ]);
    });

    // 第一次：400 → 降级重试成功（2 次请求）
    await collect(
      provider.chatStream([{ role: 'user', content: 'hi' }], {
        model: 'qwen3.6-27b',
        tools: [weatherTool],
      })
    );
    expect(calls).toHaveLength(2);

    // 第二次：命中缓存，直接不带 tools（仅 1 次请求）
    mockFetch(() =>
      streamResponse([
        {
          model: 'qwen3.6-27b',
          message: { role: 'assistant', content: 'x' },
          done: false,
        },
        {
          model: 'qwen3.6-27b',
          message: { role: 'assistant', content: '' },
          done: true,
        },
      ])
    );
    await collect(
      provider.chatStream([{ role: 'user', content: 'hi' }], {
        model: 'qwen3.6-27b',
        tools: [weatherTool],
      })
    );
    expect(calls).toHaveLength(3);
    const body = JSON.parse(calls[2].init?.body as string);
    expect(body.tools).toBeUndefined();
  });

  it('非工具原因 400 时，错误携带响应 body 真实信息', async () => {
    mockFetch(() => jsonResponse({ error: 'model not found: qwen3.6' }, 400));

    const provider = makeProvider();
    await expect(
      collect(
        provider.chatStream([{ role: 'user', content: 'hi' }], {
          model: 'qwen3.6-27b',
        })
      )
    ).rejects.toThrow(/model not found: qwen3.6/);
  });

  it('非流式 chat：模型不支持工具时降级为无 tools 重试并成功', async () => {
    let n = 0;
    mockFetch((_url, init) => {
      n++;
      if (n === 1) {
        return jsonResponse({ error: 'does not support tools' }, 400);
      }
      return jsonResponse({
        model: 'qwen3.6-27b',
        message: { role: 'assistant', content: '北京天气晴' },
        done: true,
        prompt_eval_count: 5,
        eval_count: 4,
      });
    });

    const provider = makeProvider();
    const res = await provider.chat([{ role: 'user', content: 'hi' }], {
      model: 'qwen3.6-27b',
      tools: [weatherTool],
    });

    expect(n).toBe(2);
    expect(res.content).toBe('北京天气晴');
    const secondBody = JSON.parse(calls[1].init?.body as string);
    expect(secondBody.tools).toBeUndefined();
  });
});
