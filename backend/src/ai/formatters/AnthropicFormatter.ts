/**
 * Anthropic 消息格式化器
 *
 * 处理 Anthropic Messages API 格式：
 * - system 在顶层参数中独立传递
 * - content 为 content blocks 数组
 * - tool_use / tool_result 使用特殊的 content block 类型
 * - 支持缓存控制标记（cache_control）
 *
 * 适用于: claude-3, claude-3.5, claude-4 系列
 */

import { ModelFormatter, type FormatContext, type FormatResult } from './ModelFormatter';
import type { ChatMessage, ChatResponse } from '../models/types';

/**
 * Anthropic 内容块类型
 */
interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Anthropic 工具使用块
 */
interface AnthropicToolUseBlock extends AnthropicContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Anthropic 工具结果块
 */
interface AnthropicToolResultBlock extends AnthropicContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export class AnthropicFormatter extends ModelFormatter {
  readonly supportedModels = [
    'claude-3-5-sonnet',
    'claude-3-5-haiku',
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
    'claude-opus-4',
    'claude-sonnet-4',
    'claude-haiku-4',
  ];

  /**
   * 将统一消息转换为 Anthropic 格式
   *
   * Anthropic 格式特点：
   * - system prompt 在顶层参数（不在 messages 数组中）
   * - user/assistant 角色映射
   * - tool_use 和 tool_result 是 content blocks 中的特殊类型
   */
  formatMessages(
    messages: ChatMessage[],
    context?: FormatContext
  ): FormatResult {
    const result: unknown[] = [];

    const roleMap: Record<string, string> = {
      user: 'user',
      assistant: 'assistant',
      tool: 'user',
      system: 'user',
    };

    for (const msg of messages) {
      const role = roleMap[msg.role] || 'user';
      const contentBlocks = this.toContentBlocks(msg);

      // 合并连续相同角色的消息（Anthropic 不允许相邻的相同角色）
      const lastMsg = result[result.length - 1] as Record<string, unknown> | undefined;
      if (lastMsg && lastMsg.role === role) {
        const existingBlocks = lastMsg.content as AnthropicContentBlock[];
        lastMsg.content = [...existingBlocks, ...contentBlocks];
      } else {
        result.push({ role, content: contentBlocks });
      }
    }

    return {
      messages: result,
      system: context?.systemPrompt,
    };
  }

  /**
   * 将统一消息转换为 Anthropic content blocks
   */
  private toContentBlocks(msg: ChatMessage): AnthropicContentBlock[] {
    const blocks: AnthropicContentBlock[] = [];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // assistant 消息中有 tool_calls → 转为 tool_use blocks
      for (const tc of msg.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: this.safeParseJson(tc.function.arguments),
        } as AnthropicToolUseBlock);
      }
      return blocks;
    }

    if (msg.tool_result) {
      blocks.push({
        type: 'tool_result',
        tool_use_id: msg.tool_result.tool_call_id,
        content: msg.tool_result.content,
        is_error: msg.tool_result.is_error,
      } as AnthropicToolResultBlock);
      return blocks;
    }

    if (msg.multimodal && msg.multimodal.length > 0) {
      for (const part of msg.multimodal) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          const url = part.image_url.url;
          if (url.startsWith('data:')) {
            const matches = url.match(/^data:(image\/\w+);base64,(.+)$/);
            if (matches) {
              blocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: matches[1],
                  data: matches[2],
                },
              });
            }
          } else {
            blocks.push({
              type: 'image',
              source: {
                type: 'url',
                url: part.image_url.url,
              },
            });
          }
        }
      }
      return blocks;
    }

    blocks.push({ type: 'text', text: msg.content });
    return blocks;
  }

  /**
   * 解析 Anthropic 响应
   */
  parseResponse(rawResponse: Record<string, unknown>): ChatResponse {
    const content = rawResponse.content as AnthropicContentBlock[] | undefined;

    let text = '';
    let toolCalls;

    if (content) {
      for (const block of content) {
        if (block.type === 'text') {
          text += (block as Record<string, unknown>).text as string || '';
        } else if (block.type === 'tool_use') {
          const tb = block as AnthropicToolUseBlock;
          if (!toolCalls) toolCalls = [];
          toolCalls.push({
            id: tb.id,
            name: tb.name,
            arguments: tb.input,
          });
        }
      }
    }

    const stopReason = rawResponse.stop_reason as string | undefined;
    const usage = rawResponse.usage as Record<string, unknown> | undefined;

    return {
      content: text,
      model: rawResponse.model as string | undefined,
      stop_reason: this.mapStopReason(stopReason),
      tool_calls: toolCalls,
      usage: usage
        ? {
            prompt_tokens: (usage.input_tokens as number) ?? 0,
            completion_tokens: (usage.output_tokens as number) ?? 0,
            total_tokens: ((usage.input_tokens as number) ?? 0) + ((usage.output_tokens as number) ?? 0),
            cache_read_input_tokens: usage.cache_read_input_tokens as number | undefined,
            cache_creation_input_tokens: usage.cache_creation_input_tokens as number | undefined,
          }
        : undefined,
    };
  }

  /**
   * 映射 Anthropic stop_reason 到统一格式
   */
  private mapStopReason(reason?: string): 'stop' | 'tool_calls' | 'max_tokens' {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
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
