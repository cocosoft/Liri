/**
 * OpenAI 消息格式化器
 *
 * 处理 OpenAI Chat Completions API 格式：
 * - system 放在 messages[0]
 * - content 为字符串
 * - tool_calls 标准格式
 * - 支持多模态 content 数组（text + image_url）
 *
 * 适用于: gpt-4, gpt-4o, gpt-4o-mini, gpt-3.5-turbo, o1, o1-mini, o3-mini
 */

import {
  ModelFormatter,
  type FormatContext,
  type FormatResult,
} from './ModelFormatter';
import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ContentPart } from '../models/types';

export class OpenAIFormatter extends ModelFormatter {
  readonly supportedModels = [
    'gpt-4',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3-mini',
  ];

  /**
   * 将统一消息转换为 OpenAI 格式
   */
  formatMessages(
    messages: ChatMessage[],
    context?: FormatContext
  ): FormatResult {
    const result: unknown[] = [];

    if (context?.systemPrompt) {
      result.push({ role: 'system', content: context.systemPrompt });
    }

    for (const msg of messages) {
      const formatted = this.formatSingleMessage(msg);
      if (formatted) {
        result.push(formatted);
      }
    }

    return { messages: result };
  }

  /**
   * 格式化单条消息
   */
  private formatSingleMessage(
    msg: ChatMessage
  ): Record<string, unknown> | null {
    if (msg.role === 'tool' && msg.tool_call_id) {
      return {
        role: 'tool',
        tool_call_id: msg.tool_call_id,
        content: msg.content,
      };
    }

    const base: Record<string, unknown> = {
      role: msg.role,
    };

    if (msg.multimodal && msg.multimodal.length > 0) {
      base.content = this.formatMultimodalContent(msg.multimodal);
    } else {
      base.content = msg.content;
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      base.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    if (msg.tool_result) {
      return {
        role: 'tool',
        tool_call_id: msg.tool_result.tool_call_id,
        content: msg.tool_result.content,
      };
    }

    return base;
  }

  /**
   * 格式化多模态内容
   * OpenAI 的 content 数组格式: [{type: 'text', text}, {type: 'image_url', image_url: {url}}]
   */
  private formatMultimodalContent(parts: ContentPart[]): unknown[] {
    return parts.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
        },
      };
    });
  }

  /**
   * 解析 OpenAI 响应
   */
  parseResponse(rawResponse: Record<string, unknown>): ChatResponse {
    const choices = rawResponse.choices as
      | Array<Record<string, unknown>>
      | undefined;
    const choice = choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;

    const content = (message?.content as string) ?? '';
    const finishReason = (choice?.finish_reason as string) ?? 'stop';
    const rawToolCalls = message?.tool_calls as
      | Array<Record<string, unknown>>
      | undefined;

    let toolCalls;
    if (rawToolCalls && rawToolCalls.length > 0) {
      toolCalls = rawToolCalls.map((tc) => ({
        id: tc.id as string,
        name: ((tc.function as Record<string, unknown>)?.name as string) ?? '',
        arguments: JSON.parse(
          ((tc.function as Record<string, unknown>)?.arguments as string) ??
            '{}'
        ),
      }));
    }

    const usage = rawResponse.usage as Record<string, unknown> | undefined;

    return {
      content,
      model: rawResponse.model as string | undefined,
      stop_reason: finishReason as 'stop' | 'tool_calls' | 'max_tokens',
      tool_calls: toolCalls,
      usage: usage
        ? {
            prompt_tokens: (usage.prompt_tokens as number) ?? 0,
            completion_tokens: (usage.completion_tokens as number) ?? 0,
            total_tokens: (usage.total_tokens as number) ?? 0,
            cache_read_input_tokens: usage.cache_read_input_tokens as
              | number
              | undefined,
            cache_creation_input_tokens: usage.cache_creation_input_tokens as
              | number
              | undefined,
          }
        : undefined,
    };
  }
}
