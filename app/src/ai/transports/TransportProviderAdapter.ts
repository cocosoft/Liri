/**
 * TransportProviderAdapter — AIProvider ↔ BaseTransport 桥接层
 *
 * 允许现有 Provider 将消息转换、请求构建、响应归一化委托给 BaseTransport 实现，
 * 从而消除 Provider 与 Transport 之间的传输逻辑重复。
 *
 * 用法:
 *   class MyProvider implements AIProvider {
 *     private transport = new AnthropicMessagesTransport();
 *     private adapter = new TransportProviderAdapter(this.transport);
 *
 *     async chat(messages, options) {
 *       const request = this.adapter.buildRequest({ model, messages, tools });
 *       const raw = await this.callAPI(request);
 *       return this.adapter.toChatResponse(raw, model);
 *     }
 *   }
 */
import type { BaseTransport } from './BaseTransport';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  TransportRequestParams,
} from './types';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
  ParsedToolCall,
} from '../models/types';

/**
 * 将 Provider 的 ToolDefinition[] 转换为 Transport 的 tool 格式
 */
function extractToolDefs(
  tools?: ToolDefinition[]
): TransportRequestParams['tools'] {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

/**
 * 将 Provider 的 ChatMessage[] 转换为 Transport 的 message 格式
 */
function extractMessages(messages: ChatMessage[]): Array<{
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<Record<string, unknown>>;
}> {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    tool_call_id: m.tool_call_id,
    tool_calls: m.tool_calls as Array<Record<string, unknown>> | undefined,
  }));
}

/**
 * 将 NormalizedToolCall 转换为 Provider 的 ParsedToolCall
 */
function toParsedToolCall(tc: NormalizedToolCall): ParsedToolCall {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tc.arguments);
  } catch {
    args = {};
  }
  return { id: tc.id, name: tc.name, arguments: args };
}

/**
 * 将 NormalizedResponse 的 finishReason 映射为 ChatResponse 的 stop_reason
 */
function mapFinishReason(reason: string): ChatResponse['stop_reason'] {
  if (reason === 'stop' || reason === 'end_turn') return 'stop';
  if (reason === 'tool_calls' || reason === 'tool_use') return 'tool_calls';
  if (reason === 'length' || reason === 'max_tokens') return 'max_tokens';
  return 'stop';
}

export class TransportProviderAdapter {
  constructor(public readonly transport: BaseTransport) {}

  /**
   * 构建 API 请求参数
   * 委托给 transport.buildRequest()
   */
  buildRequest(params: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    extra?: Record<string, unknown>;
  }): Record<string, unknown> {
    return this.transport.buildRequest({
      model: params.model,
      messages: extractMessages(params.messages),
      tools: extractToolDefs(params.tools),
      systemPrompt: params.systemPrompt,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      stream: params.stream,
      extra: params.extra,
    });
  }

  /**
   * 归一化提供商原始响应
   * 委托给 transport.normalizeResponse()
   */
  normalizeResponse(raw: unknown): NormalizedResponse {
    return this.transport.normalizeResponse(raw);
  }

  /**
   * 将归一化响应转换为 ChatResponse
   * @param normalized 归一化响应
   * @param model 模型名称（覆盖 normalized.model）
   */
  toChatResponse(normalized: NormalizedResponse, model?: string): ChatResponse {
    const result: ChatResponse = {
      content: normalized.content ?? '',
      model: model || normalized.model,
      stop_reason: mapFinishReason(normalized.finishReason),
      usage: {
        prompt_tokens: normalized.usage.inputTokens,
        completion_tokens: normalized.usage.outputTokens,
        cache_read_input_tokens: normalized.usage.cacheReadTokens,
        cache_creation_input_tokens: normalized.usage.cacheCreationTokens,
        total_tokens: normalized.usage.totalTokens,
      },
    };

    if (normalized.toolCalls.length > 0) {
      result.tool_calls = normalized.toolCalls.map(toParsedToolCall);
    }

    return result;
  }

  /**
   * 工具定义格式转换：Transport tool 格式 → Provider ToolDefinition[]
   */
  toToolDefinitions(
    tools?: TransportRequestParams['tools']
  ): ToolDefinition[] | undefined {
    if (!tools || tools.length === 0) return undefined;
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
   * 提取系统提示和纯消息（分离 system 消息）
   */
  splitMessages(messages: ChatMessage[]): {
    systemPrompt: string;
    chatMessages: ChatMessage[];
  } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    return {
      systemPrompt: systemMessages.map((m) => m.content).join('\n'),
      chatMessages: nonSystemMessages,
    };
  }
}
