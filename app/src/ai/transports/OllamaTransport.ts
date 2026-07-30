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

  normalizeResponse(raw: unknown): NormalizedResponse {
    const r = raw as Record<string, unknown>;
    const message = (r.message ?? {}) as Record<string, unknown>;

    let content: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];

    if (message.content) {
      content = message.content as string;
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls as Array<Record<string, unknown>>) {
        toolCalls.push({
          id: (tc.id as string) ?? '',
          name:
            ((tc.function as Record<string, unknown>)?.name as string) ??
            (tc.name as string) ??
            '',
          arguments:
            typeof (tc.function as Record<string, unknown>)?.arguments ===
            'string'
              ? ((tc.function as Record<string, unknown>).arguments as string)
              : JSON.stringify(
                  (tc.function as Record<string, unknown>)?.arguments ??
                    tc.arguments ??
                    {}
                ),
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: (r.prompt_eval_count as number) ?? 0,
        outputTokens: (r.eval_count as number) ?? 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens:
          ((r.prompt_eval_count as number) ?? 0) +
          ((r.eval_count as number) ?? 0),
      },
      reasoning: null,
      finishReason: r.done ? 'stop' : 'tool_calls',
      model: (r.model as string) ?? '',
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
