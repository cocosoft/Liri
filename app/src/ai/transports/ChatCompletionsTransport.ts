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
  readonly provider = 'chat_completions';

  /**
   * 兼容 OpenAI Chat Completions 格式的模型。
   * 不限于 OpenAI —— DeepSeek / Moonshot / Groq / Ollama / vLLM 等均可用。
   */
  readonly supportedModels = ['*'];

  /**
   * 统一 tool_calls 格式为 OpenAI 兼容格式:
   * {id, type: 'function', function: {name, arguments}}
   */
  private normalizeToolCalls(
    toolCalls: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    return toolCalls.map((tc) => {
      if (tc.type === 'function' && tc.function) {
        return tc;
      }
      return {
        id: tc.id,
        type: 'function',
        function: {
          name:
            (tc.name as string) ||
            (tc.function as Record<string, unknown>)?.name ||
            '',
          arguments:
            typeof tc.arguments === 'string'
              ? tc.arguments
              : typeof (tc.function as Record<string, unknown>)?.arguments ===
                  'string'
                ? ((tc.function as Record<string, unknown>).arguments as string)
                : JSON.stringify(
                    tc.arguments ||
                      (tc.function as Record<string, unknown>)?.arguments ||
                      {}
                  ),
        },
      };
    });
  }

  convertMessages(
    messages: Array<{
      role: string;
      content: string | null;
      tool_call_id?: string;
      tool_calls?: Array<Record<string, unknown>>;
    }>
  ): Array<Record<string, unknown>> {
    return messages
      .filter((m) => m.content !== null || m.role === 'assistant')
      .map((m) => {
        const msg: Record<string, unknown> = {
          role: m.role as string,
          content: m.content,
        };
        if (m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id;
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          msg.tool_calls = this.normalizeToolCalls(m.tool_calls);
        }
        return msg;
      });
  }

  /**
   * 将工具定义数组转换为符合特定格式的结构化数组。
   * 每个工具对象会被包裹在一个包含 type 和 function 属性的新对象中，
   * 其中 type 固定为 'function'，function 属性包含原始工具的名称、描述和参数。
   *
   * @param tools - 原始工具定义数组，每个元素包含 name、description 和 parameters 属性
   * @returns 转换后的工具数组，每个元素包含 type 和 function 属性，function 中包含原始工具的详细信息
   */
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
    // 遍历原始工具数组，将每个工具对象映射为新的结构化格式
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * 构建发送给大语言模型的请求对象。
   *
   * @param params - 传输请求参数，包含模型配置、消息历史、工具定义等。
   * @returns 格式化后的请求对象，键值对结构，可直接用于 API 调用。
   */
  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    // 转换消息格式并处理可选的工具定义
    const messages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    // 初始化基础请求参数，设置默认的最大令牌数和温度值
    const request: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 1.0,
    };

    // 传递 top_p（若指定）
    if (params.top_p !== undefined) {
      request.top_p = params.top_p;
    }

    // 仅在存在有效工具时添加工具字段
    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    // 如果启用流式输出，则添加流式标志
    if (params.stream) {
      request.stream = true;
    }

    // 合并额外的自定义参数到请求对象中
    if (params.extra) {
      Object.assign(request, params.extra);
    }

    return request;
  }

  /**
   * 将原始 API 响应数据标准化为统一的 NormalizedResponse 格式。
   * 该函数处理不同模型提供商可能存在的字段差异，提取消息内容、工具调用、用量统计及元数据。
   *
   * @param raw - 原始的 API 响应对象，结构可能因提供商而异
   * @returns 标准化后的响应对象，包含内容、工具调用、用量信息及元数据
   */
  normalizeResponse(raw: unknown): NormalizedResponse {
    const r = raw as Record<string, unknown>;
    const choice = (r.choices as Array<Record<string, unknown>>)?.[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    const usage = (r.usage ?? {}) as Record<string, number>;

    let content: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];

    // 提取文本消息内容
    if (message.content) {
      content = message.content as string;
    }

    // 解析并标准化工具调用列表，处理参数字符串化及字段兼容性
    if (message.tool_calls) {
      for (const tc of message.tool_calls as Array<Record<string, unknown>>) {
        toolCalls.push({
          id: tc.id as string,
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
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadTokens:
          (
            (r.usage as Record<string, unknown>)?.prompt_tokens_details as
              | Record<string, number>
              | undefined
          )?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      reasoning: (message.reasoning_content as string) ?? null,
      finishReason:
        ((choice as Record<string, unknown>)?.finish_reason as string) ??
        'stop',
      model: (r.model as string) ?? '',
      id: (r.id as string) ?? '',
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
