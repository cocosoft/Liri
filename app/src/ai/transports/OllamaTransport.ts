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
import { ModelRegistry } from '../models/ModelRegistry';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ai:ollama-transport');

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

    // num_ctx：应用侧上下文窗口（DB model_registry 事实来源）与服务端对齐。
    // Ollama 服务端默认 num_ctx=2048（多数模型），不传则应用按 DB 窗口截断、
    // 服务端却按 2048 执行，长上下文直接超限（与 llama.cpp 同类的窗口错配）。
    // 读 ModelRegistry 运行时缓存（DB 来源），禁止按模型名硬编码建表。
    const contextWindow = ModelRegistry.getInstance().getModel(
      params.model
    )?.contextWindow;

    // 排查锚点：num_ctx 决策。无值时日志会暴露"DB 未注册该模型 / ModelRegistry 未刷新"
    // 的窗口错配（应用按默认 200K 截断、服务端按 2048 执行）。
    if (contextWindow && contextWindow > 0) {
      logger.debug('ollama:num_ctx 决策', {
        model: params.model,
        num_ctx: contextWindow,
        source: 'db:model_registry',
      });
    } else {
      logger.warn('ollama:num_ctx 未传（ModelRegistry 无此模型或窗口为 0）', {
        model: params.model,
        fallback: '服务端默认（通常 2048）',
      });
    }

    const request: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: params.stream ?? false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 2048,
        ...(contextWindow && contextWindow > 0
          ? { num_ctx: contextWindow }
          : {}),
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
