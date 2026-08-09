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
 * Custom Models 子域 REST API 处理器
 *
 * 路由前缀: /v1/models（自定义模型 CRUD + 批量导入）
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { modelPricingService } from '../models/ModelPricingService.js';
import type { UpsertPricingParams } from '../models/ModelPricingService.js';
import { parseBody, sendJson, sendError } from './utils.js';

const logger = getLogger('ai:model-api');

export async function handleCreateCustomModel(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    // modelPricingService 已通过顶部静态 import 引入
    const { ModelRegistry } = await import('../models/ModelRegistry.js');

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
    const { modelRouter } = await import('../modelRouter.js');
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

export async function handleBulkImportModels(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    // modelPricingService 已通过顶部静态 import 引入
    const { ModelRegistry } = await import('../models/ModelRegistry.js');

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
    const { modelRouter } = await import('../modelRouter.js');
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

export async function handleToggleModel(
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
    const { ModelRegistry } = await import('../models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });
    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('../modelRouter.js');
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
export async function handleUpdateModel(
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
    const { ModelRegistry } = await import('../models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });

    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('../modelRouter.js');
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

export async function handleDeleteModel(
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
    const { ModelRegistry } = await import('../models/ModelRegistry.js');
    ModelRegistry.getInstance()
      .refreshDbPricing()
      .catch((er: unknown) => {
        // @ignore-catch: 非关键缓存刷新
        logger.warning('refreshDbPricing 失败', {
          error: (er as Error).message,
        });
      });
    // 刷新 ModelRouter UUID 缓存
    const { modelRouter } = await import('../modelRouter.js');
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
