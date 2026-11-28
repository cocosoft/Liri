// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `AIServiceImpl.convertToChatMessages`：内部消息形态 → provider 形态的**工具字段归一化**。
 *
 * 真机取证（2026-11-27，`session_mwykbdjuff65658510`）：后台压缩直传 `session.messages`，
 * 其工具声明落在 `metadata.tool_calls`、结果 id 落在 `metadata.toolCallId`；本函数此前只
 * 透传顶层 `tool_calls` ⇒ 发给摘要模型的请求里 assistant 声明全丢、只剩 tool 结果 ⇒
 * transport 逐条判孤儿剥离（`stripped_orphan_tool_results count=30/47`），摘要看不到任何
 * 工具输出。
 */
import { describe, expect, it } from 'bun:test';
import { AIServiceImpl } from '../../src/ai/services/aiService';
import type { AIServiceConfig } from '../../src/ai/models/types';

/** 取出私有转换函数（纯函数、不依赖 `this`） */
function convert(messages: unknown[]): Array<Record<string, unknown>> {
  const service = new AIServiceImpl({
    defaultModel: 'test-model',
  } as unknown as AIServiceConfig);
  const fn = (
    service as unknown as {
      convertToChatMessages(m: unknown[]): Array<Record<string, unknown>>;
    }
  ).convertToChatMessages;
  return fn.call(service, messages);
}

describe('AI 服务消息归一化：工具声明与结果 id', () => {
  it('metadata.tool_calls（内部形态）⇒ 顶层 tool_calls', () => {
    const out = convert([
      {
        role: 'assistant',
        content: '',
        metadata: {
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'grep', arguments: '{"q":"x"}' },
            },
          ],
        },
      },
    ]);

    expect(out[0]?.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'grep', arguments: '{"q":"x"}' },
      },
    ]);
  });

  it('metadata.toolCallId（内部形态）⇒ 顶层 tool_call_id，content 归一化为字符串', () => {
    const out = convert([
      {
        role: 'tool',
        content: [{ type: 'tool_result', value: 'ok', toolCallId: 'call_1' }],
        metadata: { toolCallId: 'call_1' },
      },
    ]);

    expect(out[0]?.tool_call_id).toBe('call_1');
    expect(typeof out[0]?.content).toBe('string');
  });

  it('provider 形态（顶层字段）不被改写', () => {
    const toolCalls = [
      // 元素用 any 以模拟未知历史形态，仅断言透传
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'bash', arguments: '{}' },
      },
    ];
    const out = convert([
      { role: 'assistant', content: '', tool_calls: toolCalls },
      { role: 'tool', content: 'done', tool_call_id: 'call_2' },
    ]);

    expect(out[0]?.tool_calls).toEqual(toolCalls);
    expect(out[1]?.tool_call_id).toBe('call_2');
    expect(out[1]?.content).toBe('done');
  });
});
