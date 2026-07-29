/**
 * Ollama /api/chat 传输实现
 *
 * 格式: Ollama 自定义 /api/chat 格式
 * 与 OpenAI 类似但使用 options.temperature / options.num_predict
 */
import { BaseTransport } from './BaseTransport';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  TransportRequestParams,
} from './types';

export class OllamaTransport extends BaseTransport {
  readonly provider = 'ollama';

  readonly supportedModels = [
    'qwen3:',
    'llama3:',
    'mistral:',
    'codellama:',
    'deepseek-coder:',
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
    // P2-3: Schema净化 — Ollama/llama.cpp GBNF 兼容
    const { sanitizeSchema } = require('@modules/tools/SchemaSanitizer');
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: sanitizeSchema(t.parameters),
      },
    }));
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const request: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: params.stream ?? false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 2048,
      },
    };

    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    return request;
  }

  normalizeResponse(raw: any): NormalizedResponse {
    const message = raw.message ?? {};

    let content: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];

    if (message.content) {
      content = message.content;
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id ?? '',
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
        inputTokens: raw.prompt_eval_count ?? 0,
        outputTokens: raw.eval_count ?? 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: (raw.prompt_eval_count ?? 0) + (raw.eval_count ?? 0),
      },
      reasoning: null,
      finishReason: raw.done ? 'stop' : 'tool_calls',
      model: raw.model ?? '',
      id: '',
    };
  }

  override mapFinishReason(rawReason: string): string {
    if (rawReason === 'stop' || rawReason === 'tool_calls') {
      return rawReason;
    }
    return 'stop';
  }
}
