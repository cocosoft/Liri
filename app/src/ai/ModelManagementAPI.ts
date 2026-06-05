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
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 解析请求 body */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
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
    sendJson(res, { data: created }, 201);
  } catch (err) {
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
    sendJson(res, { data: updated });
  } catch (err) {
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
    const { providerManager } = await import('./providers/ProviderManager.js');
    await providerManager.initialize();
    const ok = await providerManager.deleteProvider(id);
    if (!ok) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    sendJson(res, { success: true });
  } catch (err) {
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
    const updated = await providerManager.toggleProvider(id, !p.isActive);
    sendJson(res, { data: updated });
  } catch (err) {
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
    const { fetchModels, isLocalProvider } = await import('./providers/ModelFetcher.js');
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
    const result = await fetchModels(p.baseUrl, apiKey, p.modelsUrl, p.providerType, {
      page,
      pageSize,
      search
    });
    sendJson(res, result);
  } catch (err) {
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
    sendError(res, `获取请求日志失败: ${(err as Error).message}`, 500);
  }
}

// ─── Balance 路由 ──────────────────────────────────────

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
    sendError(res, `余额查询失败: ${(err as Error).message}`, 500);
  }
}

// ─── Pricing 路由 ──────────────────────────────────────

async function handleListPricing(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
    await modelPricingService.initialize();
    const pricing = await modelPricingService.getAllPricing();
    sendJson(res, { data: pricing });
  } catch (err) {
    sendError(res, `获取定价列表失败: ${(err as Error).message}`, 500);
  }
}

async function handleUpsertPricing(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
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
    ModelRegistry.getInstance().refreshDbPricing().catch(() => {});
    sendJson(res, { data: record }, 201);
  } catch (err) {
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
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
    await modelPricingService.initialize();
    const ok = await modelPricingService.deletePricing(modelId);
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
    ModelRegistry.getInstance().refreshDbPricing().catch(() => {});
    sendJson(res, { success: ok });
  } catch (err) {
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
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
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
      inputCostPerMillion: (body.inputCostPerMillion as number) || 0,
      outputCostPerMillion: (body.outputCostPerMillion as number) || 0,
      cacheReadCostPerMillion: (body.cacheReadCostPerMillion as number) || undefined,
      cacheWriteCostPerMillion: (body.cacheWriteCostPerMillion as number) || undefined,
    });
    
    // 在注册表中发现该模型
    const registry = ModelRegistry.getInstance();
    registry.discoverModel(modelId, {
      displayName: body.displayName as string | undefined,
      contextWindow: (body.contextWindow as number) || 200000,
      maxOutputTokens: (body.maxOutputTokens as number) || 4096,
    });
    // 刷新 ModelRegistry 定价缓存
    registry.refreshDbPricing().catch(() => {});
    
    sendJson(res, { data: record }, 201);
  } catch (err) {
    sendError(res, `创建模型失败: ${(err as Error).message}`, 500);
  }
}

async function handleBulkImportModels(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
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
    registry.refreshDbPricing().catch(() => {});

    sendJson(res, { data: { imported } }, 201);
  } catch (err) {
    console.error(`[bulk-import] 批量导入失败:`, err);
    sendError(res, `批量导入失败: ${(err as Error).message}`, 500);
  }
}

async function handleToggleModel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const modelId = decodeURIComponent(match![1]);
  try {
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
    await modelPricingService.initialize();
    const result = await modelPricingService.toggleModel(modelId);
    if (result === null) {
      sendError(res, '模型不存在', 404);
      return;
    }
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
    ModelRegistry.getInstance().refreshDbPricing().catch(() => {});
    sendJson(res, { data: { modelId, enabled: result } });
  } catch (err) {
    sendError(res, `切换模型状态失败: ${(err as Error).message}`, 500);
  }
}

async function handleDeleteModel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const modelId = decodeURIComponent(match![1]);
  try {
    const { modelPricingService } =
      await import('./models/ModelPricingService.js');
    await modelPricingService.initialize();
    const ok = await modelPricingService.deleteModel(modelId);
    if (!ok) {
      sendError(res, '模型不存在', 404);
      return;
    }
    // 刷新 ModelRegistry 定价缓存
    const { ModelRegistry } = await import('./models/ModelRegistry.js');
    ModelRegistry.getInstance().refreshDbPricing().catch(() => {});
    sendJson(res, { success: true });
  } catch (err) {
    sendError(res, `删除模型失败: ${(err as Error).message}`, 500);
  }
}

// ─── App Model Config 路由 ────────────────────────────

async function handleListAppConfigs(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { appModelRouter } = await import('./models/AppModelRouter.js');
    await appModelRouter.initialize();
    const configs = await appModelRouter.getAllConfigs();
    sendJson(res, { data: configs });
  } catch (err) {
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
    const { appModelRouter } = await import('./models/AppModelRouter.js');
    await appModelRouter.initialize();
    const config = await appModelRouter.getConfig(appType);
    if (!config) {
      sendError(res, '应用配置不存在', 404);
      return;
    }
    sendJson(res, { data: config });
  } catch (err) {
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
    const { appModelRouter } = await import('./models/AppModelRouter.js');
    await appModelRouter.initialize();
    const config = await appModelRouter.setConfig(appType, {
      model: body.model as string | undefined,
      providerId: body.providerId as string | undefined,
      fallbackModel: body.fallbackModel as string | undefined,
      fallbackProviderId: body.fallbackProviderId as string | undefined,
    });
    sendJson(res, { data: config });
  } catch (err) {
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
    const { appModelRouter } = await import('./models/AppModelRouter.js');
    await appModelRouter.initialize();
    await appModelRouter.deleteConfig(appType);
    sendJson(res, { success: true });
  } catch (err) {
    sendError(res, `删除应用配置失败: ${(err as Error).message}`, 500);
  }
}

// ─── Provider Presets ─────────────────────────────────

async function handleListPresets(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getPresetsByCategory } = await import(
      './providers/providerPresetsData.js'
    );
    const grouped = getPresetsByCategory();
    sendJson(res, { data: grouped });
  } catch (err) {
    sendError(res, `获取预设失败: ${(err as Error).message}`, 500);
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
  { method: 'POST', pattern: /^\/v1\/models$/, handler: handleCreateCustomModel },
  { method: 'POST', pattern: /^\/v1\/models\/bulk-import$/, handler: handleBulkImportModels },
  { method: 'PATCH', pattern: /^\/v1\/models\/([^/]+)\/toggle$/, handler: handleToggleModel },
  { method: 'DELETE', pattern: /^\/v1\/models\/([^/]+)$/, handler: handleDeleteModel },

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
        logger.error(`路由处理错误: ${method} ${url}`, {
          error: (err as Error).message,
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
