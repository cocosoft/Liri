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
 * Capabilities 子域 REST API 处理器
 *
 * 路由前缀: /v1/models/capabilities（能力 CRUD + 任务映射 + 验证 + 分类）
 */

import type http from 'http';
import { handleError, AppError } from '@modules/error';
import { CapabilityCategory } from '../services/CapabilityService.js';
import { parseBody, sendJson, sendError } from './utils.js';

/**
 * GET /v1/models/capabilities — 获取能力列表（支持过滤）
 */
export async function handleListCapabilities(
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
      await import('../services/CapabilityService.js');
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
export async function handleGetCapability(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const key = decodeURIComponent(match![1]);
  try {
    const { getCapabilityService } =
      await import('../services/CapabilityService.js');
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
export async function handleCreateCapability(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;

    const { getCapabilityService } =
      await import('../services/CapabilityService.js');
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
export async function handleUpdateCapability(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const key = decodeURIComponent(match![1]);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;

    const { getCapabilityService } =
      await import('../services/CapabilityService.js');
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
export async function handleDeleteCapability(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const key = decodeURIComponent(match![1]);
  try {
    const { getCapabilityService } =
      await import('../services/CapabilityService.js');
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
export async function handleBatchCapabilities(
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
      await import('../services/CapabilityService.js');
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
export async function handleGetTaskMappings(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { getCapabilityService } =
      await import('../services/CapabilityService.js');
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
export async function handleUpdateTaskMappings(
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
      await import('../services/CapabilityService.js');
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
export async function handleValidateCapabilities(
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
      await import('../services/CapabilityService.js');
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
export async function handleGetCapabilityCategories(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const { getCapabilityService } =
      await import('../services/CapabilityService.js');
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
