// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AI 请求使用量追踪器
 *
 * 在每个 AI chat() 响应后自动记录到 UsageStatsService，
 * 让 /usagestats 命令和 /v1/usage API 有真实数据。
 *
 * 使用方式:
 *   import { trackUsage } from '@modules/ai/UsageTracker';
 *   const response = await provider.chat(messages, options);
 *   trackUsage(response, { model, providerId, latencyMs });
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 使用量追踪参数 */
export interface TrackUsageParams {
  /** 模型名称 */
  model: string;
  /** 供应商ID（可选） */
  providerId?: string;
  /** 延迟 ms（可选） */
  latencyMs?: number;
  /** HTTP 状态码（可选） */
  statusCode?: number;
  /** 是否为流式请求（可选） */
  isStreaming?: boolean;
}

/**
 * 追踪一次 AI 请求的使用量
 *
 * 从 ChatResponse 中提取 tokens 和成本信息，异步写入 UsageStatsService。
 * 不会阻塞主流程，失败时静默降级。
 */
export async function trackUsage(
  response: {
    content?: string;
    stop_reason?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      total_tokens?: number;
    };
    model?: string;
    error?: Error | string;
  },
  params: TrackUsageParams,
): Promise<void> {
  try {
    const { usageStatsService } = await import('./models/UsageStatsService.js');
    await usageStatsService.initialize();

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;

    // 估算成本（优先 DB 定价 > registry > 兜底）
    let costUSD = 0;
    try {
      // 1. 优先从 ModelPricingService (DB) 获取
      try {
        const { modelPricingService } = await import('./models/ModelPricingService.js');
        await modelPricingService.initialize();
        const dbPricing = await modelPricingService.getPricing(params.model);
        if (dbPricing) {
          costUSD =
            (inputTokens / 1_000_000) * dbPricing.inputCostPerMillion +
            (outputTokens / 1_000_000) * dbPricing.outputCostPerMillion;
        }
      } catch {
        // DB 不可用，回退到 registry
      }

      // 2. 回退到 ModelRegistry
      if (costUSD === 0) {
        const { ModelRegistry } = await import('./models/ModelRegistry.js');
        const registry = ModelRegistry.getInstance();
        const pricing = registry.getModelPricing(params.model);
        if (pricing) {
          costUSD =
            (inputTokens / 1_000_000) * pricing.inputPer1M +
            (outputTokens / 1_000_000) * pricing.outputPer1M;
        }
      }
    } catch {
      // 定价查询失败，成本记 0
    }

    const isError = !!response.error;
    const statusCode = params.statusCode ?? (isError ? 500 : 200);

    await usageStatsService.logUsage({
      model: params.model,
      providerId: params.providerId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUSD,
      latencyMs: params.latencyMs ?? 0,
      statusCode,
      isStreaming: params.isStreaming ?? false,
      errorMessage: isError
        ? (typeof response.error === 'string' ? response.error : (response.error as Error)?.message)
        : undefined,
    });
  } catch (err) {
    // 使用量记录失败不阻塞主流程
    logger.debug('UsageTracker: 记录失败（非关键）', {
      error: (err as Error).message,
    });
  }
}

/**
 * 从 ChatResponse 中提取模型名称
 */
export function extractModelFromResponse(
  response: { model?: string },
  fallback: string,
): string {
  return response.model || fallback;
}

export const UsageTracker = { trackUsage, extractModelFromResponse };
