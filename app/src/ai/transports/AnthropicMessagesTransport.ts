/**
 * Messages API 传输实现（协议名，非供应商绑定）
 *
 * 将内部消息/工具格式转换为 Anthropic Messages API 格式。
 * 该协议同样被其他服务采用（如 Amazon Bedrock Converse API 等），
 * 因此以协议命名而非供应商命名。
 *
 * 参考: hermes agent/transports/anthropic.py
 */

import { BaseTransport } from './BaseTransport';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedUsage,
  TransportRequestParams,
} from './types';

interface MessagesTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface MessagesToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface MessagesToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  cache_control?: { type: 'ephemeral' };
}

type MessagesContentBlock =
  | MessagesTextBlock
  | MessagesToolUseBlock
  | MessagesToolResultBlock;

interface MessagesAPIMessage {
  role: 'user' | 'assistant';
  content: MessagesContentBlock[];
}

interface MessagesAPIToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  cache_control?: { type: 'ephemeral' };
}

export class MessagesApiTransport extends BaseTransport {
  readonly provider = 'messages_api';

  /**
   * 兼容 Messages API 协议格式的模型。
   * 不限于 Anthropic —— 任何实现同格式的 provider 均可使用。
   */
  readonly supportedModels = [
    '*',
  ];

  /** 是否启用 prompt caching */
  enableCaching = true;

  convertMessages(
    messages: Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<Record<string, unknown>>;
      tool_call_id?: string;
    }>,
  ): MessagesAPIMessage[] {
    const result: MessagesAPIMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      const blocks: MessagesContentBlock[] = [];

      if (m.role === 'system') {
        continue; // 由 buildRequest 处理为顶层 system 参数
      }

      if (m.role === 'user') {
        blocks.push({ type: 'text', text: m.content ?? '' });
      } else if (m.role === 'assistant') {
        if (m.content) {
          blocks.push({ type: 'text', text: m.content });
        }
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            const fn = (tc as any).function || tc;
            blocks.push({
              type: 'tool_use',
              id: (tc as any).id || `tc_${Math.random().toString(36).slice(2)}`,
              name: fn.name || '',
              input: typeof fn.arguments === 'string'
                ? JSON.parse(fn.arguments)
                : (fn.arguments || {}),
            });
          }
        }
      } else if (m.role === 'tool') {
        blocks.push({
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: m.content ?? '',
          cache_control: this.enableCaching ? { type: 'ephemeral' } : undefined,
        });
      }

      if (blocks.length > 0) {
        const role: 'user' | 'assistant' =
          m.role === 'tool' || m.role === 'user' ? 'user' : 'assistant';
        result.push({ role, content: blocks });
      }
    }

    return result;
  }

  convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
  ): MessagesAPIToolDef[] {
    return tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: (t.parameters.properties as Record<string, unknown>) || {},
        required: (t.parameters.required as string[]) || [],
      },
      ...(this.enableCaching && i === tools.length - 1
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages as any);
    const tools = params.tools?.length
      ? this.convertTools(params.tools as any)
      : undefined;

    const systemMsg = (params.messages as Array<{ role: string; content: string | null }>)
      .filter((m) => m.role === 'system' && m.content)
      .map((m) => ({
        type: 'text',
        text: m.content!,
        ...(this.enableCaching ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages,
    };

    if (systemMsg.length > 0) {
      body.system = systemMsg;
    }

    if (tools) {
      body.tools = tools;
    }

    if (params.temperature !== undefined && params.temperature > 0) {
      body.temperature = params.temperature;
    }

    if (params.stopSequences?.length) {
      body.stop_sequences = params.stopSequences;
    }

    return body;
  }

  normalizeResponse(raw: any): NormalizedResponse {
    const content = raw.content || [];
    const textBlocks = content.filter((b: any) => b.type === 'text');
    const toolUseBlocks = content.filter((b: any) => b.type === 'tool_use');

    const text = textBlocks.map((b: any) => b.text).join('\n');
    const toolCalls: NormalizedToolCall[] = toolUseBlocks.map((b: any) => ({
      id: b.id,
      name: b.name,
      arguments: b.input,
    }));

    const usage: NormalizedUsage = {
      inputTokens: raw.usage?.input_tokens ?? 0,
      outputTokens: raw.usage?.output_tokens ?? 0,
      totalTokens:
        (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0),
      cacheReadTokens: raw.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: raw.usage?.cache_creation_input_tokens ?? 0,
    };

    return {
      id: raw.id || '',
      model: raw.model,
      finishReason: raw.stop_reason || 'stop',
      content: text || null,
      toolCalls: toolCalls,
      reasoning: null,
      usage,
      raw,
    };
  }

  override extractCacheStats(raw: any): NormalizedUsage | null {
    if (
      raw.usage?.cache_read_input_tokens ||
      raw.usage?.cache_creation_input_tokens
    ) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: raw.usage.cache_read_input_tokens || 0,
        cacheCreationTokens: raw.usage.cache_creation_input_tokens || 0,
      };
    }
    return null;
  }

  override mapFinishReason(
    rawStopReason: string,
    hasToolCalls: boolean,
  ): string {
    if (hasToolCalls) return 'tool_calls';
    switch (rawStopReason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

/** @deprecated 使用 MessagesApiTransport */
export { MessagesApiTransport as AnthropicMessagesTransport };
