// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `parseAnthropicSSELine` 回归用例（P3-2 附带缺陷修复的锁定，2026-11-15）
 *
 * 背景：该方法曾有两个 `case 'content_block_delta'`（重复标签 ⇒ 后者不可达），
 * 导致 `input_json_delta`（tool_use 参数分片）**永不累积**，收尾组装拿到空串。
 * 本文件通过 `readSSEStream` 喂真实 Anthropic 格式 SSE，锁住「参数跨分片累积」。
 *
 * 为什么不直接调 `parseAnthropicSSELine`：它是 `protected`，且真实调用链是
 * `readSSEStream` ⇒ 用**最小探针子类**暴露受保护入口，走同一条生产路径。
 */
import { describe, it, expect } from 'bun:test';
import {
  BaseAIProvider,
  SSEFormat,
} from '@modules/ai/providers/BaseAIProvider';
// 2026-11-23（R02-002）：分片累积类型唯一真源在 streamToolCalls（BaseAIProvider 不再重复定义）
import type { PendingToolCall } from '@modules/ai/providers/streamToolCalls';
import type { ChatMessage, ChatResponse } from '@modules/ai/models/types';
import type {
  ChatOptions,
  ThinkingProviderChunk,
} from '@modules/ai/providers/AIProvider';
import type { TransportStreamEvent } from '@modules/ai/transports/types';

/** 探针子类：只实现抽象成员，暴露受保护的 SSE 读取入口 */
class ProbeProvider extends BaseAIProvider {
  constructor() {
    super({ providerId: 'probe', displayName: 'probe' });
  }

  override async chat(): Promise<ChatResponse> {
    throw new Error('unused: 本用例只测 SSE 解析');
  }

  override async *chatStream(): AsyncGenerator<
    string | ThinkingProviderChunk,
    ChatResponse,
    unknown
  > {
    throw new Error('unused: 本用例只测 SSE 解析');
  }

  override async listModels(): Promise<string[]> {
    return [];
  }

  /** 喂一段 Anthropic SSE 文本，返回发出的事件与累计的工具调用 */
  async feed(body: string): Promise<{
    events: TransportStreamEvent[];
    pending: Map<number, PendingToolCall>;
  }> {
    const events: TransportStreamEvent[] = [];
    const pending = new Map<number, PendingToolCall>();
    const response = new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    });
    await this.readSSEStream(
      response,
      SSEFormat.ANTHROPIC,
      (event) => events.push(event),
      pending
    );
    return { events, pending };
  }
}

/** 拼一条 SSE 帧 */
function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe('parseAnthropicSSELine（经 readSSEStream）', () => {
  it('tool_use 参数跨两条 input_json_delta 累积，并在 message_delta 组装出完整 arguments', async () => {
    const body = [
      sse({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'call_1', name: 'bash' },
      }),
      // 参数分片到达（Anthropic 规范：input_json_delta + partial_json）
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":' },
      }),
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"ls -la"}' },
      }),
      sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
      sse({ type: 'message_stop' }),
    ].join('');

    const { events } = await new ProbeProvider().feed(body);
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toBeDefined();
    if (toolCall?.type !== 'tool_call') throw new Error('unreachable');
    expect(toolCall.call.id).toBe('call_1');
    expect(toolCall.call.name).toBe('bash');
    expect(JSON.parse(toolCall.call.arguments as string)).toEqual({
      command: 'ls -la',
    });
    // 收尾清空，避免下一条 message_delta 重复消费
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('text_delta / thinking_delta 各自产出事件（合并 case 未改坏原分支）', async () => {
    const body = [
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '你好' },
      }),
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '想一想' },
      }),
      sse({ type: 'message_stop' }),
    ].join('');

    const { events } = await new ProbeProvider().feed(body);
    expect(events).toContainEqual({ type: 'text', content: '你好' });
    expect(events).toContainEqual({ type: 'thinking', content: '想一想' });
  });

  it('未建立 pending 的 input_json_delta 不抛错也不产出事件（健壮性）', async () => {
    const body = [
      sse({
        type: 'content_block_delta',
        index: 9,
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
      }),
      sse({ type: 'message_stop' }),
    ].join('');

    const { events } = await new ProbeProvider().feed(body);
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});
