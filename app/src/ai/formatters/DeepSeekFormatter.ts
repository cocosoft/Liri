/**
 * DeepSeek 消息格式化器
 *
 * DeepSeek API 兼容 OpenAI Chat Completions 格式，但有额外特性：
 * - 支持 FIM (Fill-in-the-Middle) 模式: prompt/ suffix
 * - prefix 和 suffix 通过额外参数传递
 *
 * 适用于: deepseek-* 系列模型
 */

import { OpenAIFormatter } from './OpenAIFormatter';
import type { FormatContext, FormatResult } from './ModelFormatter';
import type { ChatMessage, ChatResponse } from '../models/types';

export class DeepSeekFormatter extends OpenAIFormatter {
  override readonly supportedModels = [
    'deepseek-',
  ];

  /**
   * DeepSeek 消息格式基本与 OpenAI 一致
   * 额外支持 FIM 模式的 prefix/suffix 透传
   */
  override formatMessages(
    messages: ChatMessage[],
    context?: FormatContext
  ): FormatResult {
    const result = super.formatMessages(messages, context);

    if (context?.extra?.fimPrefix || context?.extra?.fimSuffix) {
      result.extra = {
        ...result.extra,
        fimPrefix: context.extra.fimPrefix,
        fimSuffix: context.extra.fimSuffix,
      };
    }

    return result;
  }

  /**
   * 解析 DeepSeek 响应
   * 响应格式与 OpenAI 一致，但可能包含额外字段
   */
  override parseResponse(rawResponse: Record<string, unknown>): ChatResponse {
    const base = super.parseResponse(rawResponse);

    if (rawResponse.fim_tokens) {
      base.content = `[FIM 完成: ${base.content}]`;
    }

    return base;
  }
}
