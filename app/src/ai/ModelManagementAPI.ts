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
 * 模型管理 REST API 路由处理器
 *
 * 为 Tauri 前端提供统一 HTTP API，打通 new services 与前端的数据通道。
 * 路由前缀: /v1/providers, /v1/usage, /v1/balance, /v1/pricing
 */

import type http from 'http';
import type { AIProvider } from './providers/AIProvider.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { ModelCapability } from './models/types';
import { CapabilityCategory } from './services/CapabilityService.js';
import { trackUsage } from '@modules/ai';
import {
  getModelCapabilities,
  getModelContextWindow,
} from './models/ModelConfigs';
import { modelPricingService } from './models/ModelPricingService.js';
import type { UpsertPricingParams } from './models/ModelPricingService.js';
import {
  readSoulMd,
  writeSoulMd,
  ensureDefaultSoulMd,
} from '@modules/services/soul/SoulReader';
import {
  readUserMd,
  writeUserMd,
  ensureDefaultUserMd,
} from '@modules/services/soul/UserReader';

const logger = getLogger('ai:model-api');

/** 解析请求 body */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        // @ignore-catch: 请求 body JSON 解析失败，非关键操作
        logger.warning('请求 body JSON 解析失败', {
          error: (err as Error).message,
        });
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** 发送错误响应 */
function sendError(
  res: http.ServerResponse,
  message: string,
  status = 400
): void {
  sendJson(res, { error: { message } }, status);
}

// ─── 路由表类型 ────────────────────────────────────────

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
) => Promise<void>;

// ─── Providers 路由 ────────────────────────────────────

async function handleListProviders(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const providers = await providerManager.listProviders();
    sendJson(res, { data: providers });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listProviders',
    });
    sendError(res, `获取供应商列表失败: ${(err as Error).message}`, 500);
  }
}

async function handleGetProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    sendJson(res, { data: p });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getProvider',
    });
    sendError(res, `获取供应商失败: ${(err as Error).message}`, 500);
  }
}

async function handleAddProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const created = await providerManager.createProvider({
      name: body.name as string,
      providerType: (body.providerType as string) || 'custom',
      baseUrl: body.baseUrl as string,
      apiKey: body.apiKey as string | undefined,
      modelsUrl: body.modelsUrl as string | undefined,
      headers: body.headers as Record<string, string> | undefined,
      notes: body.notes as string | undefined,
      icon: body.icon as string | undefined,
      iconColor: body.iconColor as string | undefined,
    } as Parameters<typeof providerManager.createProvider>[0]);

    // 实时间步到 ProviderRegistry
    const { registerProviderFromDB } =
      await import('./providers/ProviderSyncService.js');
    await registerProviderFromDB(created.id);

    sendJson(res, { data: created }, 201);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'createProvider',
    });
    sendError(res, `添加供应商失败: ${(err as Error).message}`, 500);
  }
}

async function handleUpdateProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const updated = await providerManager.updateProvider(id, body);
    if (!updated) {
      sendError(res, '供应商不存在', 404);
      return;
    }

    // 实时间步到 ProviderRegistry（配置变更后重新注册）
    const { registerProviderFromDB } =
      await import('./providers/ProviderSyncService.js');
    await registerProviderFromDB(id);

    sendJson(res, { data: updated });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateProvider',
    });
    sendError(res, `更新供应商失败: ${(err as Error).message}`, 500);
  }
}

async function handleDeleteProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    // 先从 Registry 中移除（防止 DB 删除后仍残留在运行时）
    const { unregisterProviderFromRegistry } =
      await import('./providers/ProviderSyncService.js');
    unregisterProviderFromRegistry(id);

    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const ok = await providerManager.deleteProvider(id);
    if (!ok) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deleteProvider',
    });
    sendError(res, `删除供应商失败: ${(err as Error).message}`, 500);
  }
}

async function handleToggleProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    const newActive = !p.isActive;
    const updated = await providerManager.toggleProvider(id, newActive);

    // 实时间步：激活→注册，停用→注销
    const { registerProviderFromDB, unregisterProviderFromRegistry } =
      await import('./providers/ProviderSyncService.js');
    if (newActive) {
      await registerProviderFromDB(id);
    } else {
      unregisterProviderFromRegistry(id);
    }

    sendJson(res, { data: updated });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'toggleProvider',
    });
    sendError(res, `切换供应商状态失败: ${(err as Error).message}`, 500);
  }
}

async function handleProviderStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const stats = await providerManager.getProviderStats();
    const providers = await providerManager.listProviders();
    sendJson(res, {
      data: {
        stats,
        total: providers.length,
        active: providers.filter((p) => p.isActive).length,
      },
    });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getProviderStats',
    });
    sendError(res, `获取统计失败: ${(err as Error).message}`, 500);
  }
}

async function handleProviderTest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    const { testEndpoints } = await import('./providers/SpeedTestService.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    if (p.requiresAuth && !p.apiKey) {
      sendError(res, '供应商需要 API Key 但未设置', 400);
      return;
    }
    const results = await testEndpoints([p.baseUrl]);
    sendJson(res, { data: { provider: p.name, results } });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'testProvider',
    });
    sendError(res, `测速失败: ${(err as Error).message}`, 500);
  }
}

async function handleProviderModels(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);

  // 解析分页参数
  const url = new URL(req.url || '/', 'http://localhost');
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('pageSize') || '50');
  const search = url.searchParams.get('search') || undefined;

  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    const { fetchModels, isLocalProvider } =
      await import('./providers/ModelFetcher.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }

    // 本地供应商跳过 API Key 校验
    // 云供应商需要 API Key（除非 requiresAuth 为 false）
    const isLocal = isLocalProvider(p.providerType);
    if (!isLocal && p.requiresAuth && !p.apiKey) {
      sendError(res, '供应商需要 API Key 但未设置', 400);
      return;
    }

    const apiKey = p.requiresAuth ? p.apiKey || '' : '';
    // 传递 providerType 和分页参数到 fetchModels
    const result = await fetchModels(
      p.baseUrl,
      apiKey,
      p.modelsUrl,
      p.providerType,
      {
        page,
        pageSize,
        search,
      }
    );
    sendJson(res, result);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'fetchProviderModels',
    });
    sendError(res, `获取模型列表失败: ${(err as Error).message}`, 500);
  }
}

// ─── Usage 路由 ────────────────────────────────────────

async function handleUsageSummary(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const model = url.searchParams.get('model') || undefined;
    const providerId = url.searchParams.get('providerId') || undefined;

    const { usageStatsService } = await import('./models/UsageStatsService.js');
    await usageStatsService.initialize();
    const summary = await usageStatsService.getUsageSummary(
      startDate ? parseInt(startDate) : undefined,
      endDate ? parseInt(endDate) : undefined,
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

async function handleUsageTrend(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const model = url.searchParams.get('model') || undefined;

    const { usageStatsService } = await import('./models/UsageStatsService.js');
    await usageStatsService.initialize();
    const trends = await usageStatsService.getDailyTrends(
      startDate ? parseInt(startDate) : undefined,
      endDate ? parseInt(endDate) : undefined,
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

async function handleUsageModelStats(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const { usageStatsService } = await import('./models/UsageStatsService.js');
    await usageStatsService.initialize();
    const stats = await usageStatsService.getModelStats(
      startDate ? parseInt(startDate) : undefined,
      endDate ? parseInt(endDate) : undefined
    );
    sendJson(res, { data: stats });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageModelStats',
    });
    sendError(res, `获取模型统计失败: ${(err as Error).message}`, 500);
  }
}

async function handleUsageProviderStats(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    const { usageStatsService } = await import('./models/UsageStatsService.js');
    await usageStatsService.initialize();
    const stats = await usageStatsService.getProviderStats(
      startDate ? parseInt(startDate) : undefined,
      endDate ? parseInt(endDate) : undefined
    );
    sendJson(res, { data: stats });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getUsageProviderStats',
    });
    sendError(res, `获取供应商统计失败: ${(err as Error).message}`, 500);
  }
}

async function handleUsageLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const model = url.searchParams.get('model') || undefined;
    const providerId = url.searchParams.get('providerId') || undefined;

    const { usageStatsService } = await import('./models/UsageStatsService.js');
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

// ─── Balance 路由 ──────────────────────────────────────

/**
 * GET /v1/balances — 批量查询所有活跃供应商余额（使用缓存）
 */
async function handleBatchBalances(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { BalanceStore } = await import('./providers/BalanceStore.js');
    const { providerManager } = await import('./providers/ProviderManager.js');
    const { checkBalance } = await import('./providers/BalanceChecker.js');

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
            const result = await checkBalance(p.baseUrl, p.apiKey || '');
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

async function handleBalanceQuery(
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
        await import('./providers/ProviderManager.js');
      await providerManager.initialize();
      const p = await providerManager.getProvider(body.providerId);
      if (!p) {
        sendError(res, '供应商不存在', 404);
        return;
      }
      baseUrl = p.baseUrl;
      apiKey = p.apiKey || '';
    } else if (body.baseUrl && body.apiKey) {
      baseUrl = body.baseUrl;
      apiKey = body.apiKey;
    } else {
      sendError(res, '缺少 baseUrl/apiKey 或 providerId');
      return;
    }

    const { checkBalance } = await import('./providers/BalanceChecker.js');
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

// ─── Pricing 路由 ──────────────────────────────────────

async function handleListPricing(
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

async function handleUpsertPricing(
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
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
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

async function handleDeletePricing(
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
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
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

// ─── Custom Models 路由 ──────────────────────────────

async function handleCreateCustomModel(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    // modelPricingService 已通过顶部静态 import 引入
    const { ModelRegistry } = await import('./models/ModelRegistry.js');

    await modelPricingService.initialize();

    const modelId = body.modelId as string;
    if (!modelId) {
      sendError(res, 'modelId 不能为空', 400);
      return;
    }

    // 创建模型定价记录
    const record = await modelPricingService.upsertPricing({
      modelId,
      displayName: body.displayName as string | undefined,
      providerId: body.providerId as string | undefined,
      contextWindow: (body.contextWindow as number) || 200000,
      maxOutputTokens: (body.maxOutputTokens as number) || 4096,
      capabilities: body.capabilities as string[] | undefined,
      inputCostPerMillion: (body.inputCostPerMillion as number) || 0,
      outputCostPerMillion: (body.outputCostPerMillion as number) || 0,
      cacheReadCostPerMillion:
        (body.cacheReadCostPerMillion as number) || undefined,
      cacheWriteCostPerMillion:
        (body.cacheWriteCostPerMillion as number) || undefined,
    });

    // 在注册表中发现该模型
    const registry = ModelRegistry.getInstance();
    registry.discoverModel(modelId, {
      displayName: body.displayName as string | undefined,
      contextWindow: (body.contextWindow as number) || 200000,
      maxOutputTokens: (body.maxOutputTokens as number) || 4096,
    });
    // 刷新 ModelRegistry 定价缓存
    registry.refreshDbPricing().catch((er: unknown) => {
      // @ignore-catch: 非关键缓存刷新
      logger.warning('refreshDbPricing 失败(registry)', {
        error: (er as Error).message,
      });
    });

    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('./modelRouter.js');
    modelRouter.invalidateUuidCache().catch((er: unknown) => {
      // @ignore-catch: 非关键缓存刷新
      logger.warning('invalidateUuidCache 失败', {
        error: (er as Error).message,
      });
    });

    sendJson(res, { data: record }, 201);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'createModel',
    });
    sendError(res, `创建模型失败: ${(err as Error).message}`, 500);
  }
}

async function handleBulkImportModels(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    // modelPricingService 已通过顶部静态 import 引入
    const { ModelRegistry } = await import('./models/ModelRegistry.js');

    await modelPricingService.initialize();

    const modelIds = body.modelIds as string[];
    const providerId = body.providerId as string | undefined;
    if (!Array.isArray(modelIds) || modelIds.length === 0) {
      sendError(res, 'modelIds 不能为空', 400);
      return;
    }

    let imported = 0;
    for (const modelId of modelIds) {
      if (typeof modelId !== 'string') continue;
      await modelPricingService.upsertPricing({
        modelId,
        providerId,
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
      });
      const registry = ModelRegistry.getInstance();
      registry.discoverModel(modelId, {
        contextWindow: 200000,
        maxOutputTokens: 4096,
      });
      imported++;
    }

    // 刷新 ModelRegistry 定价缓存
    const registry = ModelRegistry.getInstance();
    registry.refreshDbPricing().catch((er: unknown) => {
      // @ignore-catch: 非关键缓存刷新
      logger.warning('refreshDbPricing 失败(registry)', {
        error: (er as Error).message,
      });
    });

    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('./modelRouter.js');
    modelRouter.invalidateUuidCache().catch((er: unknown) => {
      // @ignore-catch: 非关键缓存刷新
      logger.warning('invalidateUuidCache 失败', {
        error: (er as Error).message,
      });
    });

    sendJson(res, { data: { imported } }, 201);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'bulkImportModels',
    });
    sendError(res, `批量导入失败: ${(err as Error).message}`, 500);
  }
}

async function handleToggleModel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]); // UUID
  try {
    await modelPricingService.initialize();
    const result = await modelPricingService.toggleModelById(id);
    if (result === null) {
      sendError(res, '模型不存在', 404);
      return;
    }
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });
    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('./modelRouter.js');
    modelRouter.invalidateUuidCache().catch((er: unknown) => {
      // @ignore-catch: 非关键缓存刷新
      logger.warning('invalidateUuidCache 失败', {
        error: (er as Error).message,
      });
    });
    sendJson(res, {
      data: { id, modelId: result.modelId, enabled: result.enabled },
    });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'toggleModel',
    });
    sendError(res, `切换模型状态失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/models/:id — 更新模型信息（能力标签、显示名、定价等）
 */
async function handleUpdateModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]); // UUID
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    await modelPricingService.initialize();
    const existing = await modelPricingService.getPricingById(id);
    if (!existing) {
      sendError(res, '模型不存在', 404);
      return;
    }

    const params: UpsertPricingParams = {
      modelId: existing.modelId,
      inputCostPerMillion: existing.inputCostPerMillion ?? 0,
      outputCostPerMillion: existing.outputCostPerMillion ?? 0,
      providerId: existing.providerId,
    };
    if (body.capabilities !== undefined)
      params.capabilities = body.capabilities as string[];
    if (body.displayName !== undefined)
      params.displayName = body.displayName as string;
    if (body.providerId !== undefined)
      params.providerId = body.providerId as string;
    if (body.contextWindow !== undefined)
      params.contextWindow = body.contextWindow as number;
    if (body.maxOutputTokens !== undefined)
      params.maxOutputTokens = body.maxOutputTokens as number;
    if (body.inputCostPerMillion !== undefined)
      params.inputCostPerMillion = body.inputCostPerMillion as number;
    if (body.outputCostPerMillion !== undefined)
      params.outputCostPerMillion = body.outputCostPerMillion as number;

    const record = await modelPricingService.upsertPricing(params);

    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });

    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('./modelRouter.js');
    await modelRouter.invalidateUuidCache().catch((er: unknown) => {
      logger.warning('invalidateUuidCache 失败', {
        error: (er as Error).message,
      });
    });

    sendJson(res, { data: record });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateModel',
    });
    sendError(res, `更新模型失败: ${(err as Error).message}`, 500);
  }
}

async function handleDeleteModel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]); // UUID
  try {
    await modelPricingService.initialize();
    const ok = await modelPricingService.deleteModelById(id);
    if (!ok) {
      sendError(res, '模型不存在', 404);
      return;
    }
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });
    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('./modelRouter.js');
    modelRouter.invalidateUuidCache().catch((er: unknown) => {
      // @ignore-catch: 非关键缓存刷新
      logger.warning('invalidateUuidCache 失败', {
        error: (er as Error).message,
      });
    });
    // 级联清理任务分工中对被删模型的引用
    modelRouter.cleanupTaskRef(id).catch((er: unknown) => {
      // @ignore-catch: 非关键清理
      logger.warning('cleanupTaskRef 失败', {
        error: (er as Error).message,
      });
    });
    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deleteModel',
    });
    sendError(res, `删除模型失败: ${(err as Error).message}`, 500);
  }
}

// ─── App Model Config 路由 ────────────────────────────

async function handleListAppConfigs(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { appModelConfigService } =
      await import('./models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    const configs = await appModelConfigService.getAllConfigs();
    sendJson(res, { data: configs });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listAppConfigs',
    });
    sendError(res, `获取应用配置失败: ${(err as Error).message}`, 500);
  }
}

async function handleGetAppConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const appType = decodeURIComponent(match![1]);
  try {
    const { appModelConfigService } =
      await import('./models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    const config = await appModelConfigService.getConfig(appType);
    if (!config) {
      sendError(res, '应用配置不存在', 404);
      return;
    }
    sendJson(res, { data: config });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getAppConfig',
    });
    sendError(res, `获取应用配置失败: ${(err as Error).message}`, 500);
  }
}

async function handleSetAppConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const appType = decodeURIComponent(match![1]);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { appModelConfigService } =
      await import('./models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    const config = await appModelConfigService.setConfig(appType, {
      model: body.model as string | undefined,
      providerId: body.providerId as string | undefined,
      fallbackModel: body.fallbackModel as string | undefined,
      fallbackProviderId: body.fallbackProviderId as string | undefined,
    });
    sendJson(res, { data: config });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'setAppConfig',
    });
    sendError(res, `设置应用配置失败: ${(err as Error).message}`, 500);
  }
}

async function handleDeleteAppConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const appType = decodeURIComponent(match![1]);
  try {
    const { appModelConfigService } =
      await import('./models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    await appModelConfigService.deleteConfig(appType);
    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deleteAppConfig',
    });
    sendError(res, `删除应用配置失败: ${(err as Error).message}`, 500);
  }
}

// ─── Model Runtime Handlers (merged from model-handlers.ts) ────

/**
 * GET /v1/models — 模型列表（DB 驱动）
 */
async function handleListModels(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('model.list', {});

  try {
    const { providerManager } = await import('./providers/ProviderManager.js');
    // modelPricingService 已通过顶部静态 import 引入
    await providerManager.initialize();
    await modelPricingService.initialize();

    const { syncDBProvidersToRegistry } =
      await import('./providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const providers = await providerManager.listProviders();
    const pricingList = await modelPricingService.getAllPricing();
    const pricingByModel = new Map(
      pricingList.map(
        (pr: {
          modelId: string;
          providerId?: string;
          displayName: string;
          enabled: boolean;
          inputCostPerMillion: number;
          outputCostPerMillion: number;
          cacheReadCostPerMillion: number;
          cacheWriteCostPerMillion: number;
          providerType?: string;
        }) => [pr.modelId, pr]
      )
    );

    const models: Array<{
      id: string; // UUID
      modelId: string; // 模型名
      name: string;
      provider: string;
      providerId: string;
      type: string;
      context_length: number;
      enabled: boolean;
      requiresAuth: boolean;
      pricing?: Record<string, number>;
    }> = [];

    const { providerRegistry } =
      await import('./providers/ProviderRegistry.js');

    for (const pr of pricingList) {
      let matchingProvider;
      if (pr.providerId) {
        matchingProvider = providers.find((p) => p.id === pr.providerId);
      } else {
        const modelProvider = providerRegistry.getByModel(pr.modelId);
        if (modelProvider) {
          matchingProvider = providers.find((p) => p.id === modelProvider.id);
        }
      }
      const caps =
        pr.capabilities && pr.capabilities.length > 0
          ? pr.capabilities
          : getModelCapabilities(pr.modelId);
      const modelType: string = caps.includes(ModelCapability.IMAGE_GENERATION)
        ? 'image'
        : caps.includes(ModelCapability.VIDEO_GENERATION)
          ? 'video'
          : caps.includes(ModelCapability.RERANKING)
            ? 'reranking'
            : caps.includes(ModelCapability.EMBEDDING)
              ? 'embedding'
              : caps.includes(ModelCapability.TEXT_TO_SPEECH) ||
                  caps.includes(ModelCapability.SPEECH_RECOGNITION)
                ? 'voice'
                : 'chat';

      // 仅当定价记录有匹配的活跃供应商时才纳入模型列表
      // 避免 YAML 种子数据在不配置供应商时被当作可用模型展示
      if (!matchingProvider) continue;

      models.push({
        id: pr.id, // UUID
        modelId: pr.modelId, // 模型名（新增）
        name: pr.displayName || pr.modelId,
        provider: matchingProvider.name,
        providerId: matchingProvider.id,
        requiresAuth: matchingProvider.requiresAuth,
        type: modelType,
        context_length: getModelContextWindow(pr.modelId),
        enabled:
          pr.enabled !== undefined ? pr.enabled : matchingProvider.isActive,
        pricing: {
          inputPer1M: pr.inputCostPerMillion,
          outputPer1M: pr.outputCostPerMillion,
          cacheReadPer1M: pr.cacheReadCostPerMillion || undefined,
          cacheWritePer1M: pr.cacheWriteCostPerMillion || undefined,
        } as Record<string, number>,
      });
    }

    // 不返回 mock 数据。若无活跃供应商对应的模型，返回空列表，
    // 前端据此引导用户前往配置页面。

    otel.endSpan(span, SpanStatusCode.OK);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ object: 'list', data: models }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listModels',
    });
    otel.endSpan(span, SpanStatusCode.ERROR, (err as Error).message);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ error: `获取模型列表失败: ${(err as Error).message}` })
    );
  }
}

/**
 * GET /v1/skills/system/:id/files/content — 系统技能文件内容
 */
async function handleSystemSkillFileContent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  try {
    const skillId = match?.[1] || '';
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const filePath = urlObj.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'path 参数必填' } }));
      return;
    }

    const { readFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { resolveProjectRoot, resolvePyappHome } =
      await import('@modules/core/paths');
    const pathMod = await import('path');

    const candidateDirs = [
      pathMod.join(
        resolveProjectRoot(),
        'app',
        'src',
        'builtin',
        'skills',
        decodeURIComponent(skillId)
      ),
      pathMod.join(resolvePyappHome(), 'skills', decodeURIComponent(skillId)),
    ];

    let skillDir = '';
    for (const dir of candidateDirs) {
      if (existsSync(pathMod.join(dir, 'SKILL.md'))) {
        skillDir = dir;
        break;
      }
    }

    if (!skillDir) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '技能未找到' } }));
      return;
    }

    const fullPath = pathMod.join(skillDir, filePath);
    if (!existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: '文件不存在' } }));
      return;
    }

    const content = await readFile(fullPath, 'utf-8');
    const ext = pathMod.extname(fullPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
    };
    res.writeHead(200, {
      'Content-Type': `${mimeTypes[ext] || 'text/plain'}; charset=utf-8`,
    });
    res.end(content);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getSkillFileContent',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: '读取文件失败' } }));
  }
}

/**
 * POST /v1/models/test — 测试模型连接
 */
async function handleTestModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId, providerId } = body;

    const { syncDBProvidersToRegistry } =
      await import('./providers/ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    const { providerRegistry } =
      await import('./providers/ProviderRegistry.js');
    const provider = providerRegistry.has(providerId)
      ? providerRegistry.get(providerId)
      : undefined;

    if (!provider) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({ error: { message: `Provider ${providerId} 未找到` } })
      );
      return;
    }

    const _trackStart = Date.now();
    const result = await provider.chat([{ role: 'user', content: 'ping' }], {
      model: modelId,
      maxTokens: 10,
    });

    trackUsage(result, {
      model: modelId,
      providerId: providerId,
      latencyMs: Date.now() - _trackStart,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, response: result }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'testModel',
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/current — 获取当前模型信息
 */
async function handleGetCurrentModel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const { resolveModelRoute, RouteKey } =
      await import('./router/resolveModelRoute.js');
    const { TASK_DEFINITIONS } = await import('./modelRouter.js');
    const { providerRegistry } =
      await import('./providers/ProviderRegistry.js');
    const { getTotalCostUSD } = await import('@modules/cost/CostTracker.js');

    const coreAPI = getCoreAPI();
    const lastDecision = coreAPI.getLastRouteDecision();
    const smartRouter = coreAPI.getSmartRouter();

    let routingMode: 'dynamic' | 'static' | 'off' = 'static';
    if (smartRouter?.isEnabled()) {
      routingMode = 'dynamic';
    } else if (smartRouter && !smartRouter.isEnabled()) {
      routingMode = 'off';
    }

    // 优先级：用户显式选择的模型 > 上次路由决策 > 静态路由解析
    // 用户通过状态栏/侧边栏切换模型时，handleSwitchModel 调 setModelName 存储
    // lastDecision 仅在聊天流式过程中设置，轮询时可能为空或指向旧模型
    const explicitModel = coreAPI.getModelName();
    const currentModel =
      explicitModel ||
      lastDecision?.model ||
      (await resolveModelRoute(RouteKey.CHAT));
    const defaultProviderId =
      lastDecision?.provider ?? providerRegistry.getDefaultProviderId() ?? '';

    // 查找当前模型的 UUID 并验证是否为聊天模型
    await modelPricingService.initialize();
    let currentRecord = currentModel
      ? await modelPricingService.getPricing(currentModel)
      : undefined;

    // 若当前模型为非聊天模型（如 Embedding），标记 isNonChat 让前端展示警告
    // 不再清空 currentRecord — 前端据此显示模型名 + 黄色警告而非空白
    const nonChatCaps = [
      'image_generation',
      'video_generation',
      'embedding',
      'text_to_speech',
      'speech_recognition',
      'reranking',
      'moderation',
      'image_editing',
    ];
    const isNonChat =
      currentRecord?.capabilities?.some((c) => nonChatCaps.includes(c)) ??
      false;

    const response = {
      modelId: currentRecord?.modelId || '',
      modelUuid: currentRecord?.id || '',
      provider: defaultProviderId,
      routerTier: lastDecision?.tier ?? null,
      routingMode,
      taskType: 'chat',
      costThisSession: getTotalCostUSD(),
      availableTasks: TASK_DEFINITIONS,
      isNonChat,
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(response));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getCurrentModel',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * POST /v1/models/switch — 切换模型
 *
 * 查找 Provider 的正确链路：模型记录 → providerId → ProviderRegistry，
 * 而非从模型名猜测（getByModel 只适用于无 DB 记录的临时模型）。
 */
async function handleSwitchModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId } = body; // UUID
    await modelPricingService.initialize();
    const record = await modelPricingService.getPricingById(modelId);
    if (!record?.modelId) {
      sendError(res, '模型不存在', 404);
      return;
    }
    const modelName = record.modelId;

    const { providerRegistry } =
      await import('./providers/ProviderRegistry.js');
    const { modelRouter } = await import('./modelRouter.js');

    // 正确路径：从模型记录的 providerId 查找已注册的 Provider
    let resolvedProvider: AIProvider | undefined;
    if (record.providerId) {
      const { getRegistryId, registerProviderFromDB } =
        await import('./providers/ProviderSyncService.js');
      const registryId = getRegistryId(record.providerId);
      if (registryId && providerRegistry.has(registryId)) {
        resolvedProvider = providerRegistry.get(registryId);
      } else {
        // Provider 未同步到 Registry，实时同步
        await registerProviderFromDB(record.providerId);
        const syncedId = getRegistryId(record.providerId);
        if (syncedId) {
          resolvedProvider = providerRegistry.get(syncedId);
        }
      }
    }

    if (!resolvedProvider) {
      const msg = record.providerId
        ? `模型 ${modelName} 的供应商 (${record.providerId}) 未找到或未启用`
        : `模型 ${modelName} 缺少供应商绑定`;
      sendError(res, msg, 400);
      return;
    }

    providerRegistry.setDefaultProvider(resolvedProvider.id);

    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    getCoreAPI().setModelName(modelName);

    // 持久化到 DB（current + default），同时更新 UUID→模型名 缓存
    await modelRouter.setCurrentModel(modelId, modelName);

    sendJson(res, { data: { modelId, modelName } });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'switchModel',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/tasks/definitions — 获取任务定义列表
 */
async function handleGetTaskDefinitions(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { TASK_DEFINITIONS } = await import('./modelRouter.js');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(TASK_DEFINITIONS));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getTaskDefinitions',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/tasks — 获取任务分工配置
 */
async function handleGetTasks(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { modelRouter } = await import('./modelRouter.js');
    const tasks = modelRouter.getTasks();
    await modelPricingService.initialize();
    const allModels = await modelPricingService.getAllPricing();
    const modelNames: Record<string, string> = {};
    for (const m of allModels) {
      if (m.id) modelNames[m.id] = m.displayName || m.modelId;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tasks, modelNames }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getTasks',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * PUT /v1/models/tasks — 保存任务分工配置
 */
async function handleSaveTasks(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { modelRouter } = await import('./modelRouter.js');
    await modelRouter.setTasks(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateTasks',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * S3: GET /v1/models/phase-mapping — 获取阶段→模型直配映射
 */
async function handleGetPhaseMapping(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { modelRouter } = await import('./modelRouter.js');
    const mapping = modelRouter.getPhaseMapping();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(mapping));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * S3: PUT /v1/models/phase-mapping — 保存阶段→模型直配映射
 */
async function handleSavePhaseMapping(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelRouter } = await import('./modelRouter.js');
    await modelRouter.setPhaseMapping(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * GET /v1/models/tasks/validate — 校验任务分工（检查模型能力匹配）
 */
async function handleValidateTasks(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { modelRouter } = await import('./modelRouter.js');
    const issues = await modelRouter.validateTaskAssignment();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ valid: issues.length === 0, issues }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'validateTasks',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

/**
 * PUT /v1/models/default — 设置默认模型
 *
 * 同步更新 ProviderRegistry、CoreAPI 和 ModelRouter，
 * 确保状态栏轮询和任务路由均能感知到变更。
 */
async function handleSetDefaultModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId, providerId } = body;
    if (!modelId) {
      sendError(res, 'modelId 不能为空', 400);
      return;
    }

    await modelPricingService.initialize();

    // modelId 可以是模型名（如 "deepseek-chat"）或 UUID
    let record = await modelPricingService.getPricing(modelId);
    if (!record) {
      record = await modelPricingService.getPricingById(modelId);
    }
    if (!record) {
      sendError(res, `模型 ${modelId} 不存在`, 404);
      return;
    }

    // 设置 CoreAPI 当前模型名（状态栏轮询依赖）
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    getCoreAPI().setModelName(record.modelId);

    // 持久化到 DB 并更新 UUID 缓存
    const { modelRouter } = await import('./modelRouter.js');
    await modelRouter.setCurrentModel(record.id, record.modelId);

    // 设置默认 Provider
    if (providerId) {
      const { providerRegistry } =
        await import('./providers/ProviderRegistry.js');
      try {
        providerRegistry.setDefaultProvider(providerId);
      } catch {
        // provider 不在 Registry 中，跳过（不影响模型设置）
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'setDefaultModel',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

// ─── Provider Presets ─────────────────────────────────

async function handleListPresets(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getPresetsByCategory } =
      await import('./providers/providerPresetsData.js');
    const grouped = getPresetsByCategory();
    sendJson(res, { data: grouped });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listPresets',
    });
    sendError(res, `获取预设失败: ${(err as Error).message}`, 500);
  }
}

// ─── Soul/User 路由 ─────────────────────────────────

/**
 * GET /v1/soul — 读取 SOUL.md 人格定义
 */
async function handleGetSoul(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    ensureDefaultSoulMd();
    const content = readSoulMd();
    sendJson(res, { data: { content } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'getSoul' });
    sendError(res, `读取人格定义失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/soul — 写入 SOUL.md 人格定义
 */
async function handlePutSoul(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const content = body.content as string;
    if (typeof content !== 'string' || !content.trim()) {
      sendError(res, 'content 不能为空', 400);
      return;
    }
    writeSoulMd(content);
    sendJson(res, { data: { success: true } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'putSoul' });
    sendError(res, `保存人格定义失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/user — 读取 USER.md 用户身份
 */
async function handleGetUser(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    ensureDefaultUserMd();
    const content = readUserMd();
    sendJson(res, { data: { content } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'getUser' });
    sendError(res, `读取用户身份失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/user — 写入 USER.md 用户身份
 */
async function handlePutUser(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const content = body.content as string;
    if (typeof content !== 'string' || !content.trim()) {
      sendError(res, 'content 不能为空', 400);
      return;
    }
    writeUserMd(content);
    sendJson(res, { data: { success: true } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'putUser' });
    sendError(res, `保存用户身份失败: ${(err as Error).message}`, 500);
  }
}

// ─── Capabilities 路由 ────────────────────────────────

/**
 * GET /v1/models/capabilities — 获取能力列表（支持过滤）
 */
async function handleListCapabilities(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const category = url.searchParams.get('category') || undefined;
    const enabled = url.searchParams.has('enabled')
      ? url.searchParams.get('enabled') === 'true'
      : undefined;

    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    const result = await service.getAll({ category, enabled });
    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listCapabilities',
    });
    sendError(res, `获取能力列表失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/models/capabilities/:key — 获取单个能力详情
 */
async function handleGetCapability(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const key = decodeURIComponent(match![1]);
  try {
    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    const capability = await service.get(key);
    if (!capability) {
      sendError(res, `能力 ${key} 不存在`, 404);
      return;
    }
    sendJson(res, { data: capability });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getCapability',
    });
    sendError(res, `获取能力失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/models/capabilities — 创建新能力
 */
async function handleCreateCapability(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;

    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    await service.create({
      key: body.key as string,
      category: body.category as CapabilityCategory,
      labelKey: body.labelKey as string,
      descriptionKey: body.descriptionKey as string,
      labelFallback: body.labelFallback as string,
      descriptionFallback: (body.descriptionFallback as string) || '',
      isDefault: (body.isDefault as boolean) || false,
      enabled: body.enabled !== undefined ? (body.enabled as boolean) : true,
      taskTypes: (body.taskTypes as string[]) || [],
      sortOrder: (body.sortOrder as number) || 0,
      sinceVersion: body.sinceVersion as string | undefined,
      deprecatedSince: body.deprecatedSince as string | undefined,
      dependencies: (body.dependencies as string[]) || [],
    });

    sendJson(res, { success: true }, 201);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'createCapability',
    });
    sendError(res, `创建能力失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/models/capabilities/:key — 更新能力（乐观锁）
 */
async function handleUpdateCapability(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const key = decodeURIComponent(match![1]);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;

    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    await service.update(key, {
      category: body.category as CapabilityCategory | undefined,
      labelKey: body.labelKey as string | undefined,
      descriptionKey: body.descriptionKey as string | undefined,
      labelFallback: body.labelFallback as string | undefined,
      descriptionFallback: body.descriptionFallback as string | undefined,
      isDefault: body.isDefault as boolean | undefined,
      enabled: body.enabled as boolean | undefined,
      taskTypes: body.taskTypes as string[] | undefined,
      sortOrder: body.sortOrder as number | undefined,
      sinceVersion: body.sinceVersion as string | undefined,
      deprecatedSince: body.deprecatedSince as string | undefined,
      dependencies: body.dependencies as string[] | undefined,
    });

    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateCapability',
    });
    const status =
      (err as AppError)?.code === 'CAPS_005'
        ? 404
        : (err as AppError)?.code === 'CAPS_006'
          ? 409
          : 500;
    sendError(res, `更新能力失败: ${(err as Error).message}`, status);
  }
}

/**
 * DELETE /v1/models/capabilities/:key — 删除能力（软删除）
 */
async function handleDeleteCapability(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const key = decodeURIComponent(match![1]);
  try {
    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    await service.delete(key);
    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deleteCapability',
    });
    sendError(res, `删除能力失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/models/capabilities/batch — 批量创建/更新能力
 */
async function handleBatchCapabilities(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as { data: unknown[] };
    if (!body.data || !Array.isArray(body.data) || body.data.length === 0) {
      sendError(res, 'data 不能为空', 400);
      return;
    }

    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    await service.batch(body.data as Parameters<typeof service.batch>[0]);
    sendJson(res, { success: true, count: body.data.length });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'batchCapabilities',
    });
    sendError(res, `批量操作失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/models/capabilities/task-mappings — 获取任务-能力映射列表
 */
async function handleGetTaskMappings(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    const mappings = await service.getTaskMappings();
    sendJson(res, { data: mappings });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getTaskMappings',
    });
    sendError(res, `获取任务映射失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/models/capabilities/task-mappings — 更新任务-能力映射
 */
async function handleUpdateTaskMappings(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as { data: unknown[] };
    if (!body.data || !Array.isArray(body.data) || body.data.length === 0) {
      sendError(res, 'data 不能为空', 400);
      return;
    }

    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    await service.updateTaskMappings(
      body.data as Parameters<typeof service.updateTaskMappings>[0]
    );
    sendJson(res, { success: true, count: body.data.length });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateTaskMappings',
    });
    sendError(res, `更新任务映射失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/models/capabilities/validate — 验证模型能力配置
 */
async function handleValidateCapabilities(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      taskType: string;
      modelCapabilities: string[];
    };

    if (!body.taskType || !Array.isArray(body.modelCapabilities)) {
      sendError(res, 'taskType 和 modelCapabilities 必填', 400);
      return;
    }

    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    const issues = await service.validateTaskAssignment(
      body.taskType,
      body.modelCapabilities
    );
    sendJson(res, { data: { valid: issues.length === 0, issues } });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'validateCapabilities',
    });
    sendError(res, `验证失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/models/capabilities/categories — 获取分类列表
 */
async function handleGetCapabilityCategories(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    const categories = await service.getCategories();
    sendJson(res, { data: categories });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getCapabilityCategories',
    });
    sendError(res, `获取分类失败: ${(err as Error).message}`, 500);
  }
}

// ─── 路由表 ───────────────────────────────────────────

interface RouteEntry {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

/**
 * POST /v1/translate/alternatives — 获取备选翻译
 */
async function handleTranslateAlternatives(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      word?: string;
      sourceLang?: string;
      targetLang?: string;
      context?: string;
    };

    if (!body.word || typeof body.word !== 'string' || !body.word.trim()) {
      sendError(res, 'word 不能为空', 400);
      return;
    }
    if (!body.targetLang || typeof body.targetLang !== 'string') {
      sendError(res, 'targetLang 不能为空', 400);
      return;
    }

    const { translationService } =
      await import('./translation/TranslationService.js');
    await translationService.initialize();

    const result = await translationService.getAlternatives({
      word: body.word.trim(),
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      context: body.context,
    });

    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'alternatives',
    });
    const message =
      err instanceof AppError
        ? (err as AppError).message
        : `备选翻译查询失败: ${(err as Error).message}`;
    sendError(res, message, 500);
  }
}

/**
 * POST /v1/translate — 翻译文本（非流式）
 */
async function handleTranslate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      text?: string;
      sourceLang?: string;
      targetLang?: string;
      model?: string;
    };

    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      sendError(res, 'text 不能为空', 400);
      return;
    }
    if (!body.targetLang || typeof body.targetLang !== 'string') {
      sendError(res, 'targetLang 不能为空', 400);
      return;
    }

    const { translationService } =
      await import('./translation/TranslationService.js');
    await translationService.initialize();

    const result = await translationService.translate({
      text: body.text.trim(),
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      model: body.model,
    });

    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'translate',
    });
    const message =
      err instanceof AppError
        ? (err as AppError).message
        : `翻译失败: ${(err as Error).message}`;
    sendError(res, message, 500);
  }
}

/**
 * GET /v1/translate/history — 查询翻译历史（分页）
 */
async function handleTranslateHistory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const sourceLang = url.searchParams.get('sourceLang') || undefined;
    const targetLang = url.searchParams.get('targetLang') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const starred = url.searchParams.has('starred')
      ? url.searchParams.get('starred') === 'true'
      : undefined;

    const { TranslateHistoryStore } =
      await import('./translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const result = await store.query({
      page,
      pageSize,
      sourceLang,
      targetLang,
      search,
      starred,
    });
    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'history',
    });
    sendError(res, `获取翻译历史失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/translate/history/:id/star — 切换收藏状态
 */
async function handleTranslateStar(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  try {
    const id = match?.[1];
    if (!id) {
      sendError(res, 'id 不能为空', 400);
      return;
    }

    const { TranslateHistoryStore } =
      await import('./translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const starred = await store.toggleStar(id);
    sendJson(res, { data: { starred } });
  } catch (err) {
    await handleError(err, { module: 'ai:translation', action: 'star' });
    sendError(res, `切换收藏失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/translate/history/delete — 批量删除翻译历史
 */
async function handleTranslateDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as { ids?: string[] };
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      sendError(res, 'ids 不能为空', 400);
      return;
    }

    const { TranslateHistoryStore } =
      await import('./translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const deleted = await store.deleteByIds(body.ids);
    sendJson(res, { data: { deleted } });
  } catch (err) {
    await handleError(err, { module: 'ai:translation', action: 'delete' });
    sendError(res, `批量删除失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/translate/history/export — 导出翻译历史为 JSON
 */
async function handleTranslateExport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const sourceLang = url.searchParams.get('sourceLang') || undefined;
    const targetLang = url.searchParams.get('targetLang') || undefined;

    const { TranslateHistoryStore } =
      await import('./translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const result = await store.query({
      page: 1,
      pageSize: 500,
      sourceLang,
      targetLang,
    });
    sendJson(res, { data: result.records });
  } catch (err) {
    await handleError(err, { module: 'ai:translation', action: 'export' });
    sendError(res, `导出失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/translate/stream — 流式翻译（SSE）
 */
async function handleTranslateStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      text?: string;
      sourceLang?: string;
      targetLang?: string;
      model?: string;
    };

    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      sendError(res, 'text 不能为空', 400);
      return;
    }
    if (!body.targetLang || typeof body.targetLang !== 'string') {
      sendError(res, 'targetLang 不能为空', 400);
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const { translationService } =
      await import('./translation/TranslationService.js');
    await translationService.initialize();

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    const stream = translationService.translateStream({
      text: body.text.trim(),
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      model: body.model,
    });

    for await (const chunk of stream) {
      if (aborted) break;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.end();
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'stream',
    });
    // 如果响应头还没发送，发送错误
    if (!res.headersSent) {
      const message =
        err instanceof AppError
          ? (err as AppError).message
          : `流式翻译失败: ${(err as Error).message}`;
      sendError(res, message, 500);
    } else {
      res.end();
    }
  }
}

const ROUTES: RouteEntry[] = [
  // Providers
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/presets$/,
    handler: handleListPresets,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/stats$/,
    handler: handleProviderStats,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/([^/]+)\/test$/,
    handler: handleProviderTest,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/([^/]+)\/models$/,
    handler: handleProviderModels,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/providers\/([^/]+)\/toggle$/,
    handler: handleToggleProvider,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/([^/]+)$/,
    handler: handleGetProvider,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/providers\/([^/]+)$/,
    handler: handleUpdateProvider,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/providers\/([^/]+)$/,
    handler: handleDeleteProvider,
  },
  { method: 'GET', pattern: /^\/v1\/providers$/, handler: handleListProviders },
  { method: 'POST', pattern: /^\/v1\/providers$/, handler: handleAddProvider },

  // Custom Models
  {
    method: 'POST',
    pattern: /^\/v1\/models$/,
    handler: handleCreateCustomModel,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/bulk-import$/,
    handler: handleBulkImportModels,
  },
  {
    method: 'PATCH',
    pattern: /^\/v1\/models\/([^/]+)\/toggle$/,
    handler: handleToggleModel,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/([^/]+)$/,
    handler: handleUpdateModel,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/models\/([^/]+)$/,
    handler: handleDeleteModel,
  },

  // Model runtime routes (merged from model-handlers.ts)
  {
    method: 'GET',
    pattern: /^\/v1\/models\/tasks\/definitions$/,
    handler: handleGetTaskDefinitions,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/tasks\/validate$/,
    handler: handleValidateTasks,
  },
  { method: 'GET', pattern: /^\/v1\/models\/tasks$/, handler: handleGetTasks },
  { method: 'PUT', pattern: /^\/v1\/models\/tasks$/, handler: handleSaveTasks },

  // S3: Phase mapping routes
  {
    method: 'GET',
    pattern: /^\/v1\/models\/phase-mapping$/,
    handler: handleGetPhaseMapping,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/phase-mapping$/,
    handler: handleSavePhaseMapping,
  },

  {
    method: 'GET',
    pattern: /^\/v1\/models\/current$/,
    handler: handleGetCurrentModel,
  },
  { method: 'POST', pattern: /^\/v1\/models\/test$/, handler: handleTestModel },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/switch$/,
    handler: handleSwitchModel,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/default$/,
    handler: handleSetDefaultModel,
  },
  { method: 'GET', pattern: /^\/v1\/models$/, handler: handleListModels },
  {
    method: 'GET',
    pattern: /^\/v1\/skills\/system\/([^/]+)\/files\/content$/,
    handler: handleSystemSkillFileContent,
  },

  // Usage
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/summary$/,
    handler: handleUsageSummary,
  },
  { method: 'GET', pattern: /^\/v1\/usage\/trend$/, handler: handleUsageTrend },
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/models$/,
    handler: handleUsageModelStats,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/providers$/,
    handler: handleUsageProviderStats,
  },
  { method: 'GET', pattern: /^\/v1\/usage\/logs$/, handler: handleUsageLogs },

  // Balance (统一前缀)
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/balances$/,
    handler: handleBatchBalances,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/usage\/balance$/,
    handler: handleBalanceQuery,
  },

  // Pricing
  { method: 'GET', pattern: /^\/v1\/pricing$/, handler: handleListPricing },
  { method: 'POST', pattern: /^\/v1\/pricing$/, handler: handleUpsertPricing },
  {
    method: 'DELETE',
    pattern: /^\/v1\/pricing\/([^/]+)$/,
    handler: handleDeletePricing,
  },

  // App Model Configs
  {
    method: 'GET',
    pattern: /^\/v1\/models\/app-config$/,
    handler: handleListAppConfigs,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/app-config\/([^/]+)$/,
    handler: handleGetAppConfig,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/app-config\/([^/]+)$/,
    handler: handleSetAppConfig,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/models\/app-config\/([^/]+)$/,
    handler: handleDeleteAppConfig,
  },

  // Capabilities — 特定路由必须在通用路由之前
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities$/,
    handler: handleListCapabilities,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/capabilities$/,
    handler: handleCreateCapability,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities\/task-mappings$/,
    handler: handleGetTaskMappings,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/capabilities\/task-mappings$/,
    handler: handleUpdateTaskMappings,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities\/categories$/,
    handler: handleGetCapabilityCategories,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/capabilities\/batch$/,
    handler: handleBatchCapabilities,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/capabilities\/validate$/,
    handler: handleValidateCapabilities,
  },
  // 通用路由 :key 必须放在最后
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities\/([^/]+)$/,
    handler: handleGetCapability,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/capabilities\/([^/]+)$/,
    handler: handleUpdateCapability,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/models\/capabilities\/([^/]+)$/,
    handler: handleDeleteCapability,
  },

  // Soul/User
  { method: 'GET', pattern: /^\/v1\/soul$/, handler: handleGetSoul },
  { method: 'PUT', pattern: /^\/v1\/soul$/, handler: handlePutSoul },
  { method: 'GET', pattern: /^\/v1\/user$/, handler: handleGetUser },
  { method: 'PUT', pattern: /^\/v1\/user$/, handler: handlePutUser },

  // Translation
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/stream$/,
    handler: handleTranslateStream,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/history\/delete$/,
    handler: handleTranslateDelete,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/history\/([^/]+)\/star$/,
    handler: handleTranslateStar,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/alternatives$/,
    handler: handleTranslateAlternatives,
  },
  { method: 'POST', pattern: /^\/v1\/translate$/, handler: handleTranslate },
  {
    method: 'GET',
    pattern: /^\/v1\/translate\/history\/export$/,
    handler: handleTranslateExport,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/translate\/history$/,
    handler: handleTranslateHistory,
  },
];

/**
 * 尝试匹配并处理路由，返回 true 表示已处理
 */
export async function tryHandleRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url?.split('?')[0] || '';
  const method = req.method || 'GET';

  for (const route of ROUTES) {
    if (route.method !== method) continue;

    const match = url.match(route.pattern);
    if (match) {
      try {
        await route.handler(req, res, match);
      } catch (err) {
        await handleError(err, {
          module: 'ai:modelManagement',
          action: 'routeHandler',
        });
        if (!res.headersSent) {
          sendError(
            res,
            `Internal server error: ${(err as Error).message}`,
            500
          );
        }
      }
      return true;
    }
  }

  return false;
}
