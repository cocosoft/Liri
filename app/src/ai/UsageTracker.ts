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

import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger.js';
import { LogLevel } from '@modules/monitoring';
import { extractUsage } from './tokenizer/UsageExtractor.js';
import { getCanonicalModelName } from '@modules/cost';

const logger = new OTelAwareLogger({
  module: 'ai:usageTracker',
  level: LogLevel.INFO,
});

// ============================================================
// [v1.2] 懒加载单例缓存（避免每次 LLM 调用都动态 import + initialize）
// ============================================================

let _usageStatsService: any = null;
let _costTracker: any = null;
let _costRecordRepo: any = null;
let _llmTracker: any = null;

async function getUsageStatsService() {
  if (!_usageStatsService) {
    const mod = await import('./models/UsageStatsService.js');
    await mod.usageStatsService.initialize();
    _usageStatsService = mod.usageStatsService;
  }
  return _usageStatsService!;
}

async function getOrInitCostTracker(sessionId?: string) {
  if (!_costTracker) {
    const mod = await import('@modules/cost');
    _costTracker = mod.costTracker;
  }
  if (!_costRecordRepo) {
    const mod = await import('@modules/cost');
    _costRecordRepo = mod.getCostRecordRepository();
  }
  await _costRecordRepo.initDatabase();
  _costTracker.setRecordRepository(_costRecordRepo, sessionId);
  return _costTracker;
}

async function getOrInitLLMTracker() {
  if (!_llmTracker) {
    const mod = await import('@modules/monitoring/llm/getLLMTracker');
    _llmTracker = mod.getLLMTracker();
  }
  return _llmTracker;
}

// [v1.2] 写入失败计数器（成本数据丢失感知）
let writeFailureCount = 0;
let lastFailureLogTime = 0;
const FAILURE_LOG_INTERVAL_MS = 60_000; // 每分钟最多报告一次

function incrementWriteFailure(context: string) {
  writeFailureCount++;
  const now = Date.now();
  if (now - lastFailureLogTime > FAILURE_LOG_INTERVAL_MS) {
    logger.warn('UsageTracker: 写入失败累计', {
      totalFailures: writeFailureCount,
      lastContext: context,
    });
    lastFailureLogTime = now;
  }
}

/** 获取写入失败计数（供健康检查） */
export function getWriteFailureCount(): number {
  return writeFailureCount;
}

/** 重置写入失败计数 */
export function resetWriteFailureCount(): void {
  writeFailureCount = 0;
}

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
    // [v1.2] 使用懒加载单例（首次动态 import + initialize，后续命中缓存）
    const usageStatsService = await getUsageStatsService();

    const rawUsage = extractUsage(response as Record<string, unknown>);
    const usage = response.usage;
    let inputTokens: number;
    let outputTokens: number;
    let tokenSource: string;
    let cacheReadTokens: number;
    let cacheCreationTokens: number;

    if (rawUsage && rawUsage.totalTokens > 0) {
      inputTokens = rawUsage.inputTokens;
      outputTokens = rawUsage.outputTokens;
      tokenSource = rawUsage.source;
      // [v1.2] cache 字段优先从 rawUsage 取（三级回退已在 extractUsage 中完成）
      cacheReadTokens = rawUsage.cacheReadTokens;
      cacheCreationTokens = rawUsage.cacheCreationTokens;
    } else {
      inputTokens = usage?.prompt_tokens ?? usage?.inputTokens ?? 0;
      outputTokens = usage?.completion_tokens ?? usage?.outputTokens ?? 0;
      tokenSource = inputTokens > 0 || outputTokens > 0 ? 'api' : 'estimated';
      cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
      cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
    }

    // 统一模型名规范化（确保两表一致）
    const canonicalModel = getCanonicalModelName(params.model);

    const isError = !!response.error;
    const statusCode = params.statusCode ?? (isError ? 500 : 200);

    // [v1.2] 数据流反转：addCost 为唯一计算+累计点
    // 先调 addCost 取返回值，再写 model_usage_logs（两表同源）
    // requestId 贯通两表 + LLMTracker
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let costUSD = 0;
    if (!isError) {
      try {
        // [v1.2] 使用单例缓存
        const costTracker = await getOrInitCostTracker(params.sessionId);

        costUSD = costTracker.addCost(
          canonicalModel,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          0, // webSearchRequests
          false, // isFastMode
          0, // reasoningTokens
          requestId
        );

        // 使用 addCost 返回值作为 model_usage_logs 的 cost_usd
        // 确保两表 cost 值一致（同一算法、同一数据源）
      } catch (err) {
        // addCost 失败时成本记 0，不阻塞主流程
        incrementWriteFailure('addCost');
        logger.debug('UsageTracker: addCost 失败，成本记 0', {
          model: canonicalModel,
          error: (err as Error).message,
        });
      }
    }

    await usageStatsService.logUsage({
      model: canonicalModel,
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
      requestId,
    });

    // 同步到 LLMTracker（非错误请求，成本已由 addCost 记录）
    if (!isError) {
      await syncToTrackers(params, {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        costUSD,
        canonicalModel,
        requestId,
      });

      // 实时日志输出（用户可见，自动注入 traceId/spanId）
      logger.info('API 调用', {
        model: params.model,
        providerId: params.providerId || 'unknown',
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        tokenSource,
        costUSD,
        latencyMs: params.latencyMs,
        statusCode,
      });
    }
  } catch (err) {
    // 使用量记录失败不阻塞主流程
    incrementWriteFailure('trackUsage');
    logger.debug('UsageTracker: 记录失败（非关键）', {
      error: (err as Error).message,
    });
  }
}

/** 追踪数据（用于同步到 LLMTracker） */
interface TrackUsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
  canonicalModel: string;
  requestId: string;
}

/**
 * 将使用量数据同步到 LLMTracker
 * 注意：成本已由 trackUsage 主流程通过 addCost 统一计算+持久化
 * syncToTrackers 仅处理 LLMTracker 记录（不重复调 addCost）
 */
async function syncToTrackers(
  params: TrackUsageParams,
  data: TrackUsageData
): Promise<void> {
  try {
    // [v1.2] 使用单例缓存
    const llmTracker = await getOrInitLLMTracker();
    const sessionId = params.sessionId || 'default';

    llmTracker.recordLLMCall({
      sessionId,
      requestId: data.requestId,
      model: data.canonicalModel,
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
    incrementWriteFailure('LLMTracker');
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

export const UsageTracker = {
  trackUsage,
  extractModelFromResponse,
  getWriteFailureCount,
  resetWriteFailureCount,
};
