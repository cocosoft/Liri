/**
 * 成本追踪Hook
 * 在LLM采样后追踪成本
 */

import type {
  PostSamplingHook,
  PostSamplingHookContext,
} from '../types/PostSampling';
import { CostTracker } from '../../cost/CostTracker';
import type { TokenUsage } from '../../cost/types';

/**
 * 创建成本追踪Hook
 * @param costTracker 成本追踪器实例
 * @returns Hook函数
 */
export function createCostTrackingHook(
  costTracker: CostTracker
): PostSamplingHook {
  return async (context: PostSamplingHookContext): Promise<void> => {
    const { messages, toolUseContext } = context;

    if (!toolUseContext?.session?.id) {
      return;
    }

    const sessionId = toolUseContext.session.id;
    const model = (toolUseContext as any).model || 'default';

    for (const message of messages) {
      const msg = message as any;
      if (msg.role === 'assistant' && msg.usage) {
        const usage = msg.usage;

        const tokenUsage: TokenUsage = {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheReadInputTokens: usage.cache_read_input_tokens || 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
        };

        costTracker.addUsage(model, tokenUsage, 0, sessionId);
      }
    }
  };
}

/**
 * 创建Token统计Hook
 * @param onStats 统计回调
 * @returns Hook函数
 */
export function createTokenStatsHook(
  onStats: (stats: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }) => void
): PostSamplingHook {
  return async (context: PostSamplingHookContext): Promise<void> => {
    const { messages } = context;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const message of messages) {
      const msg = message as any;
      if (msg.role === 'assistant' && msg.usage) {
        const usage = msg.usage;
        totalInputTokens += usage.input_tokens || 0;
        totalInputTokens += usage.cache_creation_input_tokens || 0;
        totalInputTokens += usage.cache_read_input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
      }
    }

    onStats({
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    });
  };
}
