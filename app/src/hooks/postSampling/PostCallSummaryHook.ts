/**
 * AI 调用聚合日志 Hook
 *
 * 在每次 AI 调用完整结束后执行，聚合本次调用的上下文信息
 * 输出一条汇总日志，自动注入 traceId/spanId。
 */

import type {
  PostSamplingHook,
  PostSamplingHookContext,
} from '../types/PostSampling';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger.js';

const logger = new OTelAwareLogger({ module: 'hooks:postCallSummary' });

/**
 * 创建 AI 调用聚合日志 Hook
 * @returns Hook 函数
 */
export function createPostCallSummaryHook(): PostSamplingHook {
  return async (context: PostSamplingHookContext): Promise<void> => {
    const { messages, toolUseContext } = context;
    const sessionId = (toolUseContext as any)?.sessionId;

    // 找到最后一条助手消息
    const lastAssistantMsg = [...messages]
      .reverse()
      .find((m: any) => m.role === 'assistant');

    if (!lastAssistantMsg) return;

    // 统计工具调用次数
    let toolCallCount = 0;
    if (Array.isArray((lastAssistantMsg as any).content)) {
      for (const block of (lastAssistantMsg as any).content) {
        if (block.type === 'tool_use') {
          toolCallCount++;
        }
      }
    }

    // 统计消息中的工具调用
    const toolCalls = (lastAssistantMsg as any).tool_calls;
    if (Array.isArray(toolCalls)) {
      toolCallCount = Math.max(toolCallCount, toolCalls.length);
    }

    logger.info('AI 调用汇总', {
      sessionId: sessionId || 'unknown',
      messageId: (lastAssistantMsg as any).id,
      toolCallCount,
      messageCount: messages.length,
      querySource: context.querySource,
    });
  };
}
