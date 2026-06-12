/**
 * 成本追踪Hook
 * 在LLM采样后追踪成本
 */

import type {
  PostSamplingHook,
  PostSamplingHookContext,
} from '../types/PostSampling';
import { CostTracker } from '@modules/cost/CostTracker';
import { calculateModelCost, getCanonicalModelName } from '@modules/cost/ModelPricing';
import { getLLMTracker } from '@modules/monitoring/llm/getLLMTracker';
import { getOTelLoggerAdapter } from '@modules/monitoring/otel/OTelLoggerAdapter.js';

/**
 * 创建成本追踪Hook
 * @param costTracker 成本追踪器实例
 * @returns Hook函数
 */
export function createCostTrackingHook(
  costTracker: CostTracker
): PostSamplingHook {
  const llmTracker = getLLMTracker();

  return async (context: PostSamplingHookContext): Promise<void> => {
    const { messages, toolUseContext } = context;

    const tc = toolUseContext as any;
    if (!tc?.session?.id) {
      return;
    }

    const sessionId = tc.session.id;
    const model = (toolUseContext as any).model || 'default';
    const provider = (toolUseContext as any).provider || 'unknown';
    const requestId = (toolUseContext as any).requestId || `${Date.now()}`;

    // 单次调用汇总计数器
    let callInputTokens = 0;
    let callOutputTokens = 0;
    let callCacheReadTokens = 0;
    let callCacheCreationTokens = 0;
    let callCostUsd = 0;
    let messageCount = 0;

    for (const message of messages) {
      const msg = message as any;
      if (msg.role === 'assistant' && msg.usage) {
        const usage = msg.usage;

        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
        const reasoningTokens = usage.reasoning_tokens || 0;

        // 计算成本
        const canonicalModelName = getCanonicalModelName(model);
        const costUsd = calculateModelCost(
          canonicalModelName,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens
        );

        // 记录到 LLMTracker
        llmTracker.recordLLMCall({
          sessionId,
          requestId,
          model,
          provider,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreateTokens: cacheCreationTokens,
          reasoningTokens,
          costUsd,
          durationMs: (toolUseContext as any).durationMs || 0,
          request: (toolUseContext as any).request,
          response: msg,
          title: (toolUseContext as any).title,
        });

        // 记录到 CostTracker
        costTracker.addCost(
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens
        );

        // 累计本次调用汇总
        callInputTokens += inputTokens;
        callOutputTokens += outputTokens;
        callCacheReadTokens += cacheReadTokens;
        callCacheCreationTokens += cacheCreationTokens;
        callCostUsd += costUsd;
        messageCount++;
      }
    }

    // 输出 OTel 结构化日志 — 单次 AI 调用汇总（info 级别，默认可见）
    if (messageCount > 0) {
      const otelLogger = getOTelLoggerAdapter();
      if (otelLogger) {
        otelLogger.info('AI 调用完成', {
          sessionId: sessionId.substring(0, 8),
          model,
          provider,
          inputTokens: callInputTokens,
          outputTokens: callOutputTokens,
          cacheReadTokens: callCacheReadTokens,
          cacheCreationTokens: callCacheCreationTokens,
          costUSD: callCostUsd,
          messageCount,
          durationMs: (toolUseContext as any).durationMs ?? 0,
        });
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
