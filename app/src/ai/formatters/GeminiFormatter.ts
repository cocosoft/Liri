/**
 * Google Gemini 消息格式化器
 *
 * 处理 Google Gemini API 格式：
 * - system_instruction 在顶层参数（与 Anthropic 类似）
 * - contents[] 数组，每条含 role + parts
 * - role 映射: user → user, assistant → model, tool → function
 * - function_call / function_response 在 parts 中
 *
 * 适用于: gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash, gemini-2.5-pro
 */

import {
  ModelFormatter,
  type FormatContext,
  type FormatResult,
} from './ModelFormatter';
import type { ChatMessage, ChatResponse } from '../models/types';

/**
 * Gemini 内容块
 */
interface GeminiPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
  function_call?: {
    name: string;
    args: Record<string, unknown>;
  };
  function_response?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export class GeminiFormatter extends ModelFormatter {
  readonly supportedModels = [
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ];

  /**
   * 将统一消息转换为 Gemini 格式
   *
   * Gemini 格式特点：
   * - system_instruction 在顶层
   * - role: user/model/function
   * - function_call 和 function_response 是 parts 中的特殊类型
   */
  formatMessages(
    messages: ChatMessage[],
    context?: FormatContext
  ): FormatResult {
    const contents: Array<{ role: string; parts: GeminiPart[] }> = [];
    let pendingParts: GeminiPart[] = [];
    let pendingRole = '';

    const roleMap: Record<string, string> = {
      user: 'user',
      assistant: 'model',
      tool: 'function',
      system: 'user',
    };

    for (const msg of messages) {
      const role = roleMap[msg.role] || 'user';
      const parts = this.toGeminiParts(msg);

      if (pendingRole && pendingRole !== role) {
        contents.push({ role: pendingRole, parts: pendingParts });
        pendingParts = [];
      }

      pendingRole = role;
      pendingParts.push(...parts);
    }

    if (pendingParts.length > 0) {
      contents.push({ role: pendingRole, parts: pendingParts });
    }

    return {
      messages: contents as unknown as unknown[],
      system: context?.systemPrompt,
    };
  }

  /**
   * 将统一消息转换为 Gemini parts
   */
  private toGeminiParts(msg: ChatMessage): GeminiPart[] {
    const parts: GeminiPart[] = [];

    if (
      msg.role === 'assistant' &&
      msg.tool_calls &&
      msg.tool_calls.length > 0
    ) {
      for (const tc of msg.tool_calls) {
        parts.push({
          function_call: {
            name: tc.function.name,
            args: this.safeParseJson(tc.function.arguments),
          },
        });
      }
      return parts;
    }

    if (msg.tool_result) {
      parts.push({
        function_response: {
          name: msg.tool_result.tool_call_id,
          response: { result: msg.tool_result.content },
        },
      });
      return parts;
    }

    if (msg.multimodal && msg.multimodal.length > 0) {
      for (const part of msg.multimodal) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
          const url = part.image_url.url;
          if (url.startsWith('data:')) {
            const matches = url.match(/^data:(image\/\w+);base64,(.+)$/);
            if (matches) {
              parts.push({
                inline_data: {
                  mime_type: matches[1],
                  data: matches[2],
                },
              });
            }
          } else {
            parts.push({ text: `[Image: ${url}]` });
          }
        }
      }
      return parts;
    }

    parts.push({ text: msg.content });
    return parts;
  }

  /**
   * 解析 Gemini 响应
   */
  parseResponse(rawResponse: Record<string, unknown>): ChatResponse {
    const candidates = rawResponse.candidates as
      | Array<Record<string, unknown>>
      | undefined;
    const candidate = candidates?.[0];
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as GeminiPart[] | undefined;

    let text = '';
    let toolCalls;

    if (parts) {
      for (const part of parts) {
        if (part.text) {
          text += part.text;
        } else if (part.function_call) {
          if (!toolCalls) toolCalls = [];
          toolCalls.push({
            id: `fc_${part.function_call.name}`,
            name: part.function_call.name,
            arguments: part.function_call.args,
          });
        }
      }
    }

    const finishReason = candidate?.finish_reason as string | undefined;
    const usageMetadata = rawResponse.usage_metadata as
      | Record<string, unknown>
      | undefined;

    return {
      content: text,
      model: rawResponse.model as string | undefined,
      stop_reason: this.mapFinishReason(finishReason),
      tool_calls: toolCalls,
      usage: usageMetadata
        ? {
            prompt_tokens: (usageMetadata.prompt_token_count as number) ?? 0,
            completion_tokens:
              (usageMetadata.candidates_token_count as number) ?? 0,
            total_tokens: (usageMetadata.total_token_count as number) ?? 0,
          }
        : undefined,
    };
  }

  /**
   * 映射 Gemini finish_reason 到统一格式
   */
  private mapFinishReason(
    reason?: string
  ): 'stop' | 'tool_calls' | 'max_tokens' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'FUNCTION_CALL':
        return 'tool_calls';
      case 'MAX_TOKENS':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }

  /**
   * 安全解析 JSON 字符串
   */
  private safeParseJson(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }
}
