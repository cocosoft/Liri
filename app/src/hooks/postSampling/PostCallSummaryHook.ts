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
    const tuc = toolUseContext as unknown as Record<string, unknown>;
    const sessionId = tuc?.sessionId;

    // 找到最后一条助手消息
    const lastAssistantMsg = [...messages].reverse().find((m) => {
      const mm = m as unknown as Record<string, unknown>;
      return mm.role === 'assistant';
    });

    if (!lastAssistantMsg) return;

    const lmsg = lastAssistantMsg as unknown as Record<string, unknown>;
    // 统计工具调用次数
    let toolCallCount = 0;
    if (Array.isArray(lmsg.content)) {
      for (const block of lmsg.content as unknown[]) {
        if ((block as Record<string, unknown>).type === 'tool_use') {
          toolCallCount++;
        }
      }
    }

    // 统计消息中的工具调用
    const toolCalls = lmsg.tool_calls;
    if (Array.isArray(toolCalls)) {
      toolCallCount = Math.max(toolCallCount, toolCalls.length);
    }

    logger.info('AI 调用汇总', {
      sessionId: sessionId || 'unknown',
      messageId: lmsg.id,
      toolCallCount,
      messageCount: messages.length,
      querySource: context.querySource,
    });
  };
}
