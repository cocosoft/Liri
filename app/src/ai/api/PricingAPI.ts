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
 * Usage + Balance + Pricing 子域 REST API 处理器
 *
 * 路由前缀: /v1/usage, /v1/usage/balance(s), /v1/pricing
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { modelPricingService } from '../models/ModelPricingService.js';
import { parseBody, sendJson, sendError, parseSecondsParam } from './utils.js';
import {
  credentialStore,
  CRED_STORED_MARKER,
} from '../credentials/CredentialStore.js';

const logger = getLogger('ai:model-api');

export async function handleUsageSummary(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    // model_usage_logs.timestamp 为秒，前端 getDateRange 传毫秒 → 统一转秒
    const startDate = parseSecondsParam(url.searchParams.get('startDate'));
    const endDate = parseSecondsParam(url.searchParams.get('endDate'));
    const model = url.searchParams.get('model') || undefined;
    const providerId = url.searchParams.get('providerId') || undefined;

    const { usageStatsService } =
      await import('../models/UsageStatsService.js');
    await usageStatsService.initialize();
    const summary = await usageStatsService.getUsageSummary(
      startDate,
      endDate,
      model,
      providerId
    );
    sendJson(res, { data: summary });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageSummary',
    });
    sendError(res, `获取用量概览失败: ${(err as Error).message}`, 500);
  }
}

export async function handleUsageTrend(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = parseSecondsParam(url.searchParams.get('startDate'));
    const endDate = parseSecondsParam(url.searchParams.get('endDate'));
    const model = url.searchParams.get('model') || undefined;

    const { usageStatsService } =
      await import('../models/UsageStatsService.js');
    await usageStatsService.initialize();
    const trends = await usageStatsService.getDailyTrends(
      startDate,
      endDate,
      model
    );
    sendJson(res, { data: trends });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageTrend',
    });
    sendError(res, `获取每日趋势失败: ${(err as Error).message}`, 500);
  }
}

export async function handleUsageModelStats(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = parseSecondsParam(url.searchParams.get('startDate'));
    const endDate = parseSecondsParam(url.searchParams.get('endDate'));

    const { usageStatsService } =
      await import('../models/UsageStatsService.js');
    await usageStatsService.initialize();
    const stats = await usageStatsService.getModelStats(startDate, endDate);
    sendJson(res, { data: stats });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageModelStats',
    });
    sendError(res, `获取模型统计失败: ${(err as Error).message}`, 500);
  }
}

export async function handleUsageProviderStats(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = parseSecondsParam(url.searchParams.get('startDate'));
    const endDate = parseSecondsParam(url.searchParams.get('endDate'));

    const { usageStatsService } =
      await import('../models/UsageStatsService.js');
    await usageStatsService.initialize();
    const stats = await usageStatsService.getProviderStats(startDate, endDate);
    sendJson(res, { data: stats });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageProviderStats',
    });
    sendError(res, `获取供应商统计失败: ${(err as Error).message}`, 500);
  }
}

export async function handleUsageLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const model = url.searchParams.get('model') || undefined;
    const providerId = url.searchParams.get('providerId') || undefined;

    const { usageStatsService } =
      await import('../models/UsageStatsService.js');
    await usageStatsService.initialize();
    const result = await usageStatsService.getRequestLogs(
      { model, providerId },
      page,
      pageSize
    );
    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageLogs',
    });
    sendError(res, `获取请求日志失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/balances — 批量查询所有活跃供应商余额（使用缓存）
 */
export async function handleBatchBalances(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { BalanceStore } = await import('../providers/BalanceStore.js');
    const { providerManager } = await import('../providers/ProviderManager.js');
    const { checkBalance } = await import('../providers/BalanceChecker.js');

    const store = BalanceStore.getInstance();
    await store.initialize();
    await providerManager.initialize();

    const providers = await providerManager.listProviders();
    const activeProviders = providers.filter((p) => p.isActive);

    // 先返回已缓存的数据
    const cached = await store.getAllBalances();
    const cachedMap = new Map(cached.map((r) => [r.providerId, r]));

    const results: Record<string, unknown>[] = [];

    // 对每个活跃 Provider：有缓存且 5 分钟内→直接返回；否则异步刷新
    const refreshPromises: Promise<void>[] = [];

    for (const p of activeProviders) {
      const cachedRecord = cachedMap.get(p.id);

      if (cachedRecord && Date.now() / 1000 - cachedRecord.queriedAt < 300) {
        // 缓存有效
        results.push({
          providerId: p.id,
          providerName: p.name,
          providerType: p.providerType,
          remaining: cachedRecord.remaining,
          total: cachedRecord.total,
          unit: cachedRecord.unit,
          queriedAt: cachedRecord.queriedAt,
          supported: cachedRecord.isSupported,
          belowThreshold: cachedRecord.belowThreshold,
        });
        continue;
      }

      // 缓存过期或不存在，先返回缓存值（如有）或占位
      if (cachedRecord) {
        results.push({
          providerId: p.id,
          providerName: p.name,
          providerType: p.providerType,
          remaining: cachedRecord.remaining,
          total: cachedRecord.total,
          unit: cachedRecord.unit,
          queriedAt: cachedRecord.queriedAt,
          supported: cachedRecord.isSupported,
          belowThreshold: cachedRecord.belowThreshold,
        });
      } else {
        results.push({
          providerId: p.id,
          providerName: p.name,
          providerType: p.providerType,
          remaining: null,
          total: null,
          unit: 'CNY',
          queriedAt: null,
          supported: true,
          belowThreshold: false,
        });
      }

      // 异步刷新余额
      refreshPromises.push(
        (async () => {
          try {
            const result = await checkBalance(
              p.baseUrl,
              p.apiKey === CRED_STORED_MARKER
                ? credentialStore.get(p.id) || ''
                : p.apiKey || ''
            );
            if (result.success && result.data.length > 0) {
              const d = result.data[0];
              await store.setBalance(p.id, {
                remaining: d.remaining ?? null,
                total: d.total ?? null,
                used: d.used ?? null,
                unit: d.unit || 'CNY',
                isSupported: true,
                belowThreshold: d.remaining !== undefined && d.remaining < 10,
              });
            } else {
              await store.setBalance(p.id, {
                remaining: null,
                total: null,
                used: null,
                isSupported: false,
                belowThreshold: false,
              });
            }
          } catch (err) {
            // @ignore-catch: 单个供应商余额查询失败不影响其他
            logger.warning('单个供应商余额查询失败', {
              providerId: p.id,
              error: (err as Error).message,
            });
          }
        })()
      );
    }

    // 非阻塞刷新，立即返回当前数据
    sendJson(res, { data: results });

    // 后台执行刷新
    if (refreshPromises.length > 0) {
      Promise.all(refreshPromises).catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新 // @ignore-catch: 非关键后台余额刷新
        logger.warning('批量余额刷新失败', { error: (er as Error).message });
      });
    }
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getBatchBalances',
    });
    sendError(res, `批量余额查询失败: ${(err as Error).message}`, 500);
  }
}

export async function handleBalanceQuery(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      baseUrl?: string;
      apiKey?: string;
      providerId?: string;
    };

    let baseUrl: string;
    let apiKey: string;

    if (body.providerId) {
      const { providerManager } =
        await import('../providers/ProviderManager.js');
      await providerManager.initialize();
      const p = await providerManager.getProvider(body.providerId);
      if (!p) {
        sendError(res, '供应商不存在', 404);
        return;
      }
      baseUrl = p.baseUrl;
      apiKey =
        p.apiKey === CRED_STORED_MARKER
          ? credentialStore.get(p.id) || ''
          : p.apiKey || '';
    } else if (body.baseUrl && body.apiKey) {
      baseUrl = body.baseUrl;
      apiKey = body.apiKey;
    } else {
      sendError(res, '缺少 baseUrl/apiKey 或 providerId');
      return;
    }

    const { checkBalance } = await import('../providers/BalanceChecker.js');
    const result = await checkBalance(baseUrl, apiKey);
    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'queryBalance',
    });
    sendError(res, `余额查询失败: ${(err as Error).message}`, 500);
  }
}

export async function handleListPricing(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // modelPricingService 已通过顶部静态 import 引入
    await modelPricingService.initialize();
    const pricing = await modelPricingService.getAllPricing();
    sendJson(res, { data: pricing });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listPricing',
    });
    sendError(res, `获取定价列表失败: ${(err as Error).message}`, 500);
  }
}

export async function handleUpsertPricing(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    // modelPricingService 已通过顶部静态 import 引入
    await modelPricingService.initialize();
    const record = await modelPricingService.upsertPricing({
      modelId: body.modelId as string,
      displayName: body.displayName as string | undefined,
      inputCostPerMillion: body.inputCostPerMillion as number,
      outputCostPerMillion: body.outputCostPerMillion as number,
      cacheReadCostPerMillion: body.cacheReadCostPerMillion as
        | number
        | undefined,
      cacheWriteCostPerMillion: body.cacheWriteCostPerMillion as
        | number
        | undefined,
      costMultiplier: body.costMultiplier as number | undefined,
      pricingSource: body.pricingSource as string | undefined,
    });
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('../models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });
    sendJson(res, { data: record }, 201);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'upsertPricing',
    });
    sendError(res, `更新定价失败: ${(err as Error).message}`, 500);
  }
}

export async function handleDeletePricing(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const modelId = decodeURIComponent(match![1]);
  try {
    // modelPricingService 已通过顶部静态 import 引入
    await modelPricingService.initialize();
    const ok = await modelPricingService.deletePricing(modelId);
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('../models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });
    sendJson(res, { success: ok });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deletePricing',
    });
    sendError(res, `删除定价失败: ${(err as Error).message}`, 500);
  }
}
