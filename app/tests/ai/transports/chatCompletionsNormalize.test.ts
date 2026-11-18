// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`ChatCompletionsTransport.normalizeResponse` 的**响应归一化**特征化锁
 * （外移前先测）。
 *
 * 该方法是所有 OpenAI 兼容供应商（OpenAI / DeepSeek / Moonshot / Grok / Ollama / Azure…）
 * 的响应唯一归一入口，此前没有回归锁。这里钉住：
 *   ① 正文与 usage 主字段；
 *   ② cache 三级回退（OpenAI → Anthropic → DeepSeek）与 cache 写入回退；
 *   ③ 工具调用 arguments 的字符串/对象/缺失三态与 `function.name → tc.name` 回落；
 *   ④ 缺字段时的默认值（content=null / finishReason=stop / model='' / id=''）；
 *   ⑤ 空补全（既无正文又无工具调用）⇒ 一条 `transport:empty_completion` 取证日志。
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { getLogger } from '@openliri/infra/monitoring';
import { ChatCompletionsTransport } from '../../../src/ai/transports/ChatCompletionsTransport';

const transport = new ChatCompletionsTransport();

describe('ChatCompletionsTransport.normalizeResponse（P3-2 外移前特征化）', () => {
  it('正文与 usage 主字段', () => {
    const r = transport.normalizeResponse({
      id: 'chatcmpl-1',
      model: 'some-model',
      choices: [{ message: { content: 'hello' }, finish_reason: 'tool_calls' }],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      },
    });

    expect(r.content).toBe('hello');
    expect(r.usage.inputTokens).toBe(11);
    expect(r.usage.outputTokens).toBe(7);
    expect(r.usage.totalTokens).toBe(18);
    expect(r.finishReason).toBe('tool_calls');
    expect(r.model).toBe('some-model');
    expect(r.id).toBe('chatcmpl-1');
    expect(r.toolCalls).toEqual([]);
  });

  it('cacheReadTokens 三级回退：OpenAI → Anthropic → DeepSeek', () => {
    const openai = transport.normalizeResponse({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens_details: { cached_tokens: 5 } },
    });
    expect(openai.usage.cacheReadTokens).toBe(5);

    const anthropic = transport.normalizeResponse({
      choices: [{ message: { content: 'x' } }],
      usage: { cache_read_input_tokens: 6 },
    });
    expect(anthropic.usage.cacheReadTokens).toBe(6);

    const deepseek = transport.normalizeResponse({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_cache_hit_tokens: 7 },
    });
    expect(deepseek.usage.cacheReadTokens).toBe(7);

    const none = transport.normalizeResponse({
      choices: [{ message: { content: 'x' } }],
      usage: {},
    });
    expect(none.usage.cacheReadTokens).toBe(0);
  });

  it('cacheCreationTokens：Anthropic → DeepSeek 回退', () => {
    const anthropic = transport.normalizeResponse({
      choices: [{ message: { content: 'x' } }],
      usage: { cache_creation_input_tokens: 9 },
    });
    expect(anthropic.usage.cacheCreationTokens).toBe(9);

    const deepseek = transport.normalizeResponse({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_cache_miss_tokens: 4 },
    });
    expect(deepseek.usage.cacheCreationTokens).toBe(4);
  });

  it('工具调用：arguments 字符串原样、对象序列化、缺失回落空对象', () => {
    const r = transport.normalizeResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'c1',
                function: { name: 'bash', arguments: '{"command":"ls"}' },
              },
              {
                id: 'c2',
                function: { name: 'file_read', arguments: { path: 'a.ts' } },
              },
              { id: 'c3', name: 'glob' },
            ],
          },
        },
      ],
      usage: {},
    });

    expect(r.toolCalls).toHaveLength(3);
    expect(r.toolCalls[0]).toEqual({
      id: 'c1',
      name: 'bash',
      arguments: '{"command":"ls"}',
    });
    expect(r.toolCalls[1].name).toBe('file_read');
    expect(JSON.parse(r.toolCalls[1].arguments)).toEqual({ path: 'a.ts' });
    // function.name 缺失 ⇒ 回落顶层 name；arguments 全缺 ⇒ '{}'
    expect(r.toolCalls[2].name).toBe('glob');
    expect(r.toolCalls[2].arguments).toBe('{}');
  });

  it('缺字段默认值：content=null / finishReason=stop / model 与 id 为空串', () => {
    const r = transport.normalizeResponse({ choices: [{}], usage: {} });

    expect(r.content).toBeNull();
    expect(r.finishReason).toBe('stop');
    expect(r.model).toBe('');
    expect(r.id).toBe('');
    expect(r.reasoning).toBeNull();
  });

  it('空补全（无正文无工具调用）⇒ 一条 empty_completion 取证日志', () => {
    const spy = spyOn(getLogger('ai:transports:chat-completions'), 'warn');
    try {
      transport.normalizeResponse({
        choices: [{ message: { content: null }, finish_reason: 'length' }],
        usage: { completion_tokens: 128 },
      });

      const calls = (
        spy.mock.calls as Array<[string, Record<string, unknown>]>
      ).filter((c) => c[0] === 'transport:empty_completion');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toMatchObject({
        finishReason: 'length',
        completionTokens: 128,
        contentType: 'object',
        reasoningChars: 0,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
