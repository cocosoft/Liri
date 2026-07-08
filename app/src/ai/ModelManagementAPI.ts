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

import type http from 'node:http';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { ModelCapability } from './models/types';
import {
  getModelCapabilities,
  getModelContextWindow,
} from './models/ModelConfigs';
import { modelPricingService } from './models/ModelPricingService.js';
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
          : caps.includes(ModelCapability.EMBEDDING)
            ? 'embedding'
            : caps.includes(ModelCapability.TEXT_TO_SPEECH) ||
                caps.includes(ModelCapability.SPEECH_RECOGNITION)
              ? 'voice'
              : 'chat';

      models.push({
        id: pr.id, // UUID
        modelId: pr.modelId, // 模型名（新增）
        name: pr.displayName || pr.modelId,
        provider: matchingProvider?.name || pr.modelId.split('-')[0],
        providerId: matchingProvider?.id || '',
        requiresAuth: matchingProvider ? matchingProvider.requiresAuth : true,
        type: modelType,
        context_length: getModelContextWindow(pr.modelId),
        enabled:
          pr.enabled !== undefined
            ? pr.enabled
            : matchingProvider
              ? matchingProvider.isActive
              : true,
        pricing: {
          inputPer1M: pr.inputCostPerMillion,
          outputPer1M: pr.outputCostPerMillion,
          cacheReadPer1M: pr.cacheReadCostPerMillion || undefined,
          cacheWritePer1M: pr.cacheWriteCostPerMillion || undefined,
        } as Record<string, number>,
      });
    }

    if (models.length === 0) {
      models.push({
        id: 'pyapp-default', // 兜底 UUID
        modelId: 'pyapp-default', // 兜底模型名
        name: 'Liri 默认',
        provider: 'pyapp',
        providerId: '',
        requiresAuth: false,
        type: 'chat',
        context_length: 65536,
        enabled: true,
      });
    }

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

    const result = await provider.chat([{ role: 'user', content: 'ping' }], {
      model: modelId,
      maxTokens: 10,
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

    const currentModel =
      lastDecision?.model ?? (await resolveModelRoute(RouteKey.CHAT));
    const defaultProviderId =
      lastDecision?.provider ?? providerRegistry.getDefaultProviderId() ?? '';

    // 查找当前模型的 UUID
    await modelPricingService.initialize();
    const currentRecord = await modelPricingService.getPricing(currentModel);

    const response = {
      modelId: currentModel, // 模型名
      modelUuid: currentRecord?.id || '', // 新增 UUID
      provider: defaultProviderId,
      routerTier: lastDecision?.tier ?? null,
      routingMode,
      taskType: 'chat',
      costThisSession: getTotalCostUSD(),
      availableTasks: TASK_DEFINITIONS,
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
 */
async function handleSwitchModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId } = body; // 这是 UUID
    await modelPricingService.initialize();
    const record = await modelPricingService.getPricingById(modelId);
    const modelName = record?.modelId || modelId; // 回退到原值

    const { providerRegistry } =
      await import('./providers/ProviderRegistry.js');
    const { modelRouter } = await import('./modelRouter.js');

    const resolvedProvider = providerRegistry.getByModel(modelName);
    if (resolvedProvider) {
      providerRegistry.setDefaultProvider(resolvedProvider.id);

      const { getCoreAPI } =
        await import('@modules/runtime/api/CoreAPIImpl.js');
      getCoreAPI().setModelName(modelName);
    } else {
      providerRegistry.setDefaultProvider(modelName);
    }

    // 持久化到 ConfigManager（models.current + tasks.default）
    modelRouter.setCurrentModel(modelId); // 存 UUID

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true }));
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
    modelRouter.setTasks(body);
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
 */
async function handleSetDefaultModel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, string>;
    const { modelId } = body;
    const { providerRegistry } =
      await import('./providers/ProviderRegistry.js');
    providerRegistry.setDefaultProvider(modelId);
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

// ─── 路由表 ───────────────────────────────────────────

interface RouteEntry {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
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

  // Balance
  { method: 'GET', pattern: /^\/v1\/balances$/, handler: handleBatchBalances },
  { method: 'POST', pattern: /^\/v1\/balance$/, handler: handleBalanceQuery },

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

  // Soul/User
  { method: 'GET', pattern: /^\/v1\/soul$/, handler: handleGetSoul },
  { method: 'PUT', pattern: /^\/v1\/soul$/, handler: handlePutSoul },
  { method: 'GET', pattern: /^\/v1\/user$/, handler: handleGetUser },
  { method: 'PUT', pattern: /^\/v1\/user$/, handler: handlePutUser },
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
