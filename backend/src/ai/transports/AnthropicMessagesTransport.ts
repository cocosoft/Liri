/**
 * Anthropic Messages API 传输实现
 * 对标 Hermes agent/transports/anthropic.py（AnthropicTransport）
 *
 * 复用现有的 ai/clients/PromptCacheConfig.ts 进行缓存控制
 */
import { BaseTransport } from './BaseTransport';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedUsage,
  TransportRequestParams,
} from './types';
import {
  isCacheSupported,
  calculateBreakpoints,
  shouldPlaceSystemBreakpoint,
  shouldPlaceBreakpoint,
  shouldPlaceToolsBreakpoint,
  createCacheControl,
  DEFAULT_CACHE_CONFIG,
} from '../clients/PromptCacheConfig';

export class AnthropicMessagesTransport extends BaseTransport {
  readonly provider = 'anthropic';

  readonly supportedModels = [
    'claude-opus-4-6',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ];

  convertMessages(
    messages: Array<{ role: string; content: string | null }>
  ): Array<{ role: string; content: string }> {
    const roleMap: Record<string, string> = {
      user: 'user',
      assistant: 'assistant',
      tool: 'user',
      system: 'user',
    };

    const useCache = isCacheSupported('claude-sonnet-4-6');
    const breakpoints = calculateBreakpoints(messages.length);

    return messages
      .filter((m) => m.content !== null)
      .map((m, index) => {
        const msg: Record<string, unknown> = {
          role: roleMap[m.role] || 'user',
          content: m.content,
        };

        if (useCache && shouldPlaceBreakpoint(index, breakpoints)) {
          msg.content = [
            {
              type: 'text',
              text: m.content,
              cache_control: createCacheControl(),
            },
          ];
        }

        return msg as { role: string; content: string };
      });
  }

  convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  ): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    const useCache = isCacheSupported('claude-sonnet-4-6');
    const breakpoints = calculateBreakpoints(tools.length);

    return tools.map((t, index) => {
      const tool: Record<string, unknown> = {
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      };

      if (
        useCache &&
        shouldPlaceToolsBreakpoint(breakpoints) &&
        index === tools.length - 1
      ) {
        tool.cache_control = createCacheControl();
      }

      return tool as {
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
      };
    });
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;
    const useCache = isCacheSupported(params.model);
    const breakpoints = useCache
      ? calculateBreakpoints(params.messages.length)
      : [];

    const request: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 1.0,
    };

    let systemContent: unknown = params.systemPrompt || '';

    if (useCache && shouldPlaceSystemBreakpoint(breakpoints) && systemContent) {
      systemContent = [
        {
          type: 'text',
          text: systemContent,
          cache_control: createCacheControl(),
        },
      ];
    }

    if (systemContent) {
      request.system = systemContent;
    }

    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    if (params.stream) {
      request.stream = true;
    }

    return request;
  }

  normalizeResponse(raw: any): NormalizedResponse {
    const content = raw.content || [];

    let textContent: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        textContent = (textContent || '') + block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens: raw.usage?.input_tokens ?? 0,
        outputTokens: raw.usage?.output_tokens ?? 0,
        cacheReadTokens: raw.usage?.cache_read_input_tokens ?? 0,
        cacheCreationTokens: raw.usage?.cache_creation_input_tokens ?? 0,
        totalTokens:
          (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0),
      },
      reasoning: null,
      finishReason: raw.stop_reason ?? 'end_turn',
      model: raw.model ?? '',
      id: raw.id ?? '',
    };
  }

  override extractCacheStats(raw: any): NormalizedUsage | null {
    if (!raw.usage) {
      return null;
    }
    return {
      inputTokens: raw.usage.input_tokens ?? 0,
      outputTokens: raw.usage.output_tokens ?? 0,
      cacheReadTokens: raw.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: raw.usage.cache_creation_input_tokens ?? 0,
      totalTokens:
        (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
    };
  }

  override mapFinishReason(rawReason: string): string {
    const reasonMap: Record<string, string> = {
      end_turn: 'stop',
      max_tokens: 'length',
      tool_use: 'tool_calls',
      stop_sequence: 'stop',
    };
    return reasonMap[rawReason] || rawReason;
  }
}
