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
 *   import { trackUsage } from '@modules/ai';
 *   const response = await provider.chat(messages, options);
 *   trackUsage(response, { model, providerId, latencyMs });
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { getOTelLoggerAdapter } from '@modules/monitoring/otel/OTelLoggerAdapter.js';

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
  /** 会话ID（可选，用于 LLMTracker 分组） */
  sessionId?: string;
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
      /** ChatManager 使用的字段名（等价于 prompt_tokens） */
      inputTokens?: number;
      /** ChatManager 使用的字段名（等价于 completion_tokens） */
      outputTokens?: number;
    };
    model?: string;
    error?: Error | string;
  },
  params: TrackUsageParams
): Promise<void> {
  try {
    const { usageStatsService } = await import('./models/UsageStatsService.js');
    await usageStatsService.initialize();

    // 兼容两种 usage 字段名：OpenAI 标准 (prompt_tokens/completion_tokens) 和 ChatManager (inputTokens/outputTokens)
    const usage = response.usage;
    const inputTokens = usage?.prompt_tokens ?? usage?.inputTokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? usage?.outputTokens ?? 0;
    const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;

    // 估算成本（优先 DB 定价 > registry > 兜底）
    let costUSD = 0;
    try {
      // 1. 优先从 ModelPricingService (DB) 获取
      try {
        const { modelPricingService } =
          await import('./models/ModelPricingService.js');
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
        ? typeof response.error === 'string'
          ? response.error
          : (response.error as Error)?.message
        : undefined,
    });

    // 输出 OTel 结构化日志（debug 级别，默认不可见）
    const otelLogger = getOTelLoggerAdapter();
    if (otelLogger && !isError) {
      otelLogger.debug('API 调用', {
        model: params.model,
        providerId: params.providerId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        costUSD,
        latencyMs: params.latencyMs,
        statusCode,
      });
    }

    // 同步数据到 CostTracker + LLMTracker（绕过 PostSampling 管道，直接在此处调用）
    if (!isError) {
      await syncToTrackers(params, {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        costUSD,
      });

      // 实时日志输出（用户可见，便于监控 API 调用）
      logger.info(
        `API ${params.model} | in=${inputTokens} out=${outputTokens} ` +
          `cache=${cacheReadTokens}/${cacheCreationTokens} cost=$${costUSD.toFixed(4)} | ${params.providerId || 'unknown'}`
      );
    }
  } catch (err) {
    // 使用量记录失败不阻塞主流程
    logger.debug('UsageTracker: 记录失败（非关键）', {
      error: (err as Error).message,
    });
  }
}

/** 追踪数据（用于同步到 CostTracker / LLMTracker） */
interface TrackUsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
}

/**
 * 将使用量数据同步到 CostTracker 和 LLMTracker
 * 绕过 PostSampling 管道直接调用，确保数据流不依赖 QueryEngine
 */
async function syncToTrackers(
  params: TrackUsageParams,
  data: TrackUsageData
): Promise<void> {
  try {
    // 同步到 CostTracker（累计统计）
    const { costTracker } = await import('@modules/cost/CostTracker');
    const { getCostRecordRepository } =
      await import('@modules/cost/CostRecordRepository');

    // 确保 recordRepository 已初始化（防止启动时序问题导致静默跳过持久化）
    const repository = getCostRecordRepository();
    await repository.initDatabase();
    costTracker.setRecordRepository(repository, params.sessionId);

    costTracker.addCost(
      params.model,
      data.inputTokens,
      data.outputTokens,
      data.cacheReadTokens,
      data.cacheCreationTokens
    );

    // 同步到 LLMTracker（按会话分组）
    const { getLLMTracker } =
      await import('@modules/monitoring/llm/getLLMTracker');
    const llmTracker = getLLMTracker();
    const sessionId = params.sessionId || 'default';
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    llmTracker.recordLLMCall({
      sessionId,
      requestId,
      model: params.model,
      provider: params.providerId || 'unknown',
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      cacheCreateTokens: data.cacheCreationTokens,
      costUsd: data.costUSD,
      durationMs: params.latencyMs ?? 0,
    });
  } catch (err) {
    // 同步失败不阻塞主流程，记录诊断日志
    logger.info('UsageTracker: syncToTrackers 同步失败', {
      model: params.model,
      error: (err as Error).message,
    });
  }
}

/**
 * 从 ChatResponse 中提取模型名称
 */
export function extractModelFromResponse(
  response: { model?: string },
  fallback: string
): string {
  return response.model || fallback;
}

export const UsageTracker = { trackUsage, extractModelFromResponse };
