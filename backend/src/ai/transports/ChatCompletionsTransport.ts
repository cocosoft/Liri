/**
 * OpenAI Chat Completions 格式传输实现
 * 对标 Hermes agent/transports/chat_completions.py（ChatCompletionsTransport）
 *
 * 适用于: OpenAI / DeepSeek / Moonshot / Grok / Ollama / Azure OpenAI 等
 * 所有遵循 OpenAI chat/completions 格式标准的提供商
 */
import { BaseTransport } from './BaseTransport';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedUsage,
  TransportRequestParams,
} from './types';

export class ChatCompletionsTransport extends BaseTransport {
  readonly provider = 'openai';

  readonly supportedModels = [
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3-mini',
  ];

  convertMessages(
    messages: Array<{ role: string; content: string | null }>
  ): Array<{ role: string; content: string }> {
    return messages
      .filter((m) => m.content !== null)
      .map((m) => ({
        role: m.role as string,
        content: m.content!,
      }));
  }

  convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  ): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const request: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 1.0,
    };

    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    if (params.stream) {
      request.stream = true;
    }

    if (params.extra) {
      Object.assign(request, params.extra);
    }

    return request;
  }

  normalizeResponse(raw: any): NormalizedResponse {
    const choice = raw.choices?.[0];
    const message = choice?.message ?? {};
    const usage = raw.usage ?? {};

    let content: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];

    if (message.content) {
      content = message.content;
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function?.name ?? tc.name ?? '',
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments ?? tc.arguments ?? {}),
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      reasoning: message.reasoning_content ?? null,
      finishReason: choice?.finish_reason ?? 'stop',
      model: raw.model ?? '',
      id: raw.id ?? '',
    };
  }

  override mapFinishReason(rawReason: string): string {
    const reasonMap: Record<string, string> = {
      stop: 'stop',
      length: 'length',
      tool_calls: 'tool_calls',
      content_filter: 'content_filter',
    };
    return reasonMap[rawReason] || rawReason;
  }
}
