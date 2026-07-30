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
  readonly supportedModels = ['*'];

  /** 是否启用 prompt caching */
  enableCaching = true;

  convertMessages(
    messages: Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<Record<string, unknown>>;
      tool_call_id?: string;
    }>
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
            const fn =
              (tc.function as Record<string, unknown> | undefined) || tc;
            blocks.push({
              type: 'tool_use',
              id:
                (tc.id as string) ||
                `tc_${Math.random().toString(36).slice(2)}`,
              name: (fn.name as string) || '',
              input: (typeof fn.arguments === 'string'
                ? JSON.parse(fn.arguments)
                : fn.arguments || {}) as Record<string, unknown>,
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
    }>
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
    const messages = this.convertMessages(params.messages);
    const tools = params.tools?.length
      ? this.convertTools(params.tools)
      : undefined;

    const systemMsg = (
      params.messages as Array<{ role: string; content: string | null }>
    )
      .filter((m) => m.role === 'system' && m.content)
      .map((m) => ({
        type: 'text',
        text: m.content!,
        ...(this.enableCaching
          ? { cache_control: { type: 'ephemeral' as const } }
          : {}),
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

  normalizeResponse(raw: unknown): NormalizedResponse {
    const r = raw as Record<string, unknown>;
    const content = (r.content as Array<Record<string, unknown>>) || [];
    const textBlocks = content.filter((b) => b.type === 'text');
    const toolUseBlocks = content.filter((b) => b.type === 'tool_use');

    const text = textBlocks.map((b) => b.text as string).join('\n');
    const toolCalls: NormalizedToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id as string,
      name: b.name as string,
      arguments: JSON.stringify(b.input),
    }));

    const usageData = (r.usage || {}) as Record<string, number>;

    const usage: NormalizedUsage = {
      inputTokens: usageData.input_tokens ?? 0,
      outputTokens: usageData.output_tokens ?? 0,
      totalTokens:
        (usageData.input_tokens ?? 0) + (usageData.output_tokens ?? 0),
      cacheReadTokens: usageData.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usageData.cache_creation_input_tokens ?? 0,
    };

    return {
      id: (r.id as string) || '',
      model: r.model as string,
      finishReason: (r.stop_reason as string) || 'stop',
      content: text || null,
      toolCalls: toolCalls,
      reasoning: null,
      usage,
      raw: r,
    };
  }

  override extractCacheStats(raw: unknown): NormalizedUsage | null {
    const r = raw as Record<string, unknown>;
    const usageData = r.usage as Record<string, number> | undefined;
    if (
      usageData?.cache_read_input_tokens ||
      usageData?.cache_creation_input_tokens
    ) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: usageData.cache_read_input_tokens || 0,
        cacheCreationTokens: usageData.cache_creation_input_tokens || 0,
      };
    }
    return null;
  }

  override mapFinishReason(
    rawStopReason: string,
    hasToolCalls: boolean
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
