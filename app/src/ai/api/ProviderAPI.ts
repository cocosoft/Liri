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
 * Providers 子域 REST API 处理器
 *
 * 路由前缀: /v1/providers
 */

import type http from 'http';
import { handleError, AppError } from '@modules/error';
import { parseBody, sendJson, sendError } from './utils.js';
import type { ProviderRecord } from '../providers/ProviderManager.js';
import {
  credentialStore,
  CRED_STORED_MARKER,
} from '../credentials/CredentialStore.js';
import { broadcastEvent } from '@modules/infrastructure';

/** 掩码常量：已配置凭据时不泄露任何密钥字符 */
const MASKED_KEY = '••••••••';

/** 广播 Provider 拓扑变更（对齐 dsh llm/adapters-updated，前端订阅刷新） */
function notifyProvidersChanged(action: string, providerId: string): void {
  try {
    broadcastEvent('providers:changed', { action, providerId });
  } catch {
    // @ignore-catch: SSE 不可用不影响写操作结果
  }
}

/** 解析 Provider 的真实 API Key（P0 凭据迁移：DB 占位 → CredentialStore） */
function resolveRealApiKey(p: ProviderRecord): string {
  return p.apiKey === CRED_STORED_MARKER
    ? credentialStore.get(p.id) || ''
    : p.apiKey || '';
}

/** 脱敏 Provider 记录：不向客户端泄露明文密钥，附 hasKey 状态 */
function sanitizeProvider(p: ProviderRecord): ProviderRecord & {
  hasKey: boolean;
} {
  const realKey = resolveRealApiKey(p);
  return {
    ...p,
    apiKey: realKey ? MASKED_KEY : undefined,
    hasKey: !!realKey,
  };
}

export async function handleListProviders(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { providerManager } = await import('../providers/ProviderManager.js');
    await providerManager.initialize();
    const providers = await providerManager.listProviders();
    sendJson(res, { data: providers.map(sanitizeProvider) });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listProviders',
    });
    sendError(res, `获取供应商列表失败: ${(err as Error).message}`, 500);
  }
}

export async function handleGetProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const { providerManager } = await import('../providers/ProviderManager.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    sendJson(res, { data: sanitizeProvider(p) });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getProvider',
    });
    sendError(res, `获取供应商失败: ${(err as Error).message}`, 500);
  }
}

export async function handleAddProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { providerManager } = await import('../providers/ProviderManager.js');
    await providerManager.initialize();
    const created = await providerManager.createProvider({
      name: body.name as string,
      providerType: (body.providerType as string) || 'custom',
      baseUrl: body.baseUrl as string,
      apiKey: body.apiKey as string | undefined,
      modelsUrl: body.modelsUrl as string | undefined,
      headers: composeDawateHeaders(
        body,
        undefined,
        body.providerType === 'dawate'
      ),
      notes: body.notes as string | undefined,
      icon: body.icon as string | undefined,
      iconColor: body.iconColor as string | undefined,
    } as Parameters<typeof providerManager.createProvider>[0]);

    // 实时间步到 ProviderRegistry
    const { registerProviderFromDB } =
      await import('../providers/ProviderSyncService.js');
    await registerProviderFromDB(created.id);
    notifyProvidersChanged('create', created.id);

    sendJson(res, { data: sanitizeProvider(created) }, 201);
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'createProvider',
    });
    sendError(res, `添加供应商失败: ${(err as Error).message}`, 500);
  }
}

/**
 * 组装「私有化部署」（dawate）的 headers（appId/agentId）：
 * 表单以顶层 appId/agentId 字段提交，落库统一存 headers JSON；
 * 其余类型沿用通用 body.headers 透传。
 * @param isDawate type 是否为 dawate（更新时允许按现有 type 判定）
 */
function composeDawateHeaders(
  body: Record<string, unknown>,
  existingHeaders?: Record<string, string>,
  isDawate?: boolean
): Record<string, string> | undefined {
  const bodyHeaders =
    body.headers && typeof body.headers === 'object'
      ? (body.headers as Record<string, string>)
      : undefined;
  if (isDawate === false && !bodyHeaders) return bodyHeaders;

  const merged: Record<string, string> = {
    ...(existingHeaders ?? {}),
    ...(bodyHeaders ?? {}),
  };
  if (isDawate !== false) {
    if (typeof body.appId === 'string' && body.appId) {
      merged['appId'] = body.appId;
    }
    if (typeof body.agentId === 'string' && body.agentId) {
      merged['agentId'] = body.agentId;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export async function handleUpdateProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { providerManager } = await import('../providers/ProviderManager.js');
    await providerManager.initialize();
    const { expectedRevision, ...rest } = body;

    // 私有化部署（dawate）：表单 appId/agentId → headers 合并更新（编辑留空=保留原值）
    const existing = await providerManager.getProvider(id);
    if (existing) {
      const effectiveType =
        (body.providerType as string | undefined) ?? existing.providerType;
      const headers = composeDawateHeaders(
        body,
        existing.headers,
        effectiveType === 'dawate'
      );
      if (headers !== undefined) rest['headers'] = headers;
    }

    const updated = await providerManager.updateProvider(id, {
      ...rest,
      expectedRevision:
        typeof expectedRevision === 'number' ? expectedRevision : undefined,
    });
    if (!updated) {
      sendError(res, '供应商不存在', 404);
      return;
    }

    // 实时间步到 ProviderRegistry（配置变更后重新注册）
    const { registerProviderFromDB } =
      await import('../providers/ProviderSyncService.js');
    await registerProviderFromDB(id);
    notifyProvidersChanged('update', id);

    sendJson(res, { data: sanitizeProvider(updated) });
  } catch (err) {
    if (err instanceof AppError && err.code === 'PROVIDER_STALE_WRITE') {
      // D9 乐观并发：stale write 冲突 → 409，前端提示刷新
      sendError(res, err.message, 409);
      return;
    }
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'updateProvider',
    });
    sendError(res, `更新供应商失败: ${(err as Error).message}`, 500);
  }
}

export async function handleDeleteProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    // 先从 Registry 中移除（防止 DB 删除后仍残留在运行时）
    const { unregisterProviderFromRegistry } =
      await import('../providers/ProviderSyncService.js');
    unregisterProviderFromRegistry(id);

    const { providerManager } = await import('../providers/ProviderManager.js');
    await providerManager.initialize();
    const ok = await providerManager.deleteProvider(id);
    if (!ok) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    notifyProvidersChanged('delete', id);
    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deleteProvider',
    });
    sendError(res, `删除供应商失败: ${(err as Error).message}`, 500);
  }
}

export async function handleToggleProvider(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const { providerManager } = await import('../providers/ProviderManager.js');
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
      await import('../providers/ProviderSyncService.js');
    if (newActive) {
      await registerProviderFromDB(id);
    } else {
      unregisterProviderFromRegistry(id);
    }
    notifyProvidersChanged(newActive ? 'enable' : 'disable', id);

    sendJson(res, { data: updated ? sanitizeProvider(updated) : undefined });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'toggleProvider',
    });
    sendError(res, `切换供应商状态失败: ${(err as Error).message}`, 500);
  }
}

export async function handleProviderStats(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { providerManager } = await import('../providers/ProviderManager.js');
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

export async function handleProviderTest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const id = decodeURIComponent(match![1]);
  try {
    const { providerManager } = await import('../providers/ProviderManager.js');
    const { testEndpoints } = await import('../providers/SpeedTestService.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }
    const apiKey = resolveRealApiKey(p);
    if (p.requiresAuth && !apiKey) {
      sendError(res, '供应商需要 API Key 但未设置', 400);
      return;
    }

    // dawate（私有化内网）：非 OpenAI 兼容，改测 generateAppKey（换 appKey 即通）
    if (p.providerType === 'dawate') {
      const { testDawateConnection } =
        await import('../providers/DawateProvider.js');
      let headers: Record<string, unknown> = {};
      try {
        const raw =
          typeof p.headers === 'string' ? JSON.parse(p.headers) : p.headers;
        if (raw && typeof raw === 'object')
          headers = raw as Record<string, unknown>;
      } catch {
        headers = {};
      }
      const pick = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim() ? v.trim() : undefined;
      const insecureRaw = headers['insecureSkipVerify'];
      const insecureSkipVerify =
        insecureRaw === true ||
        (typeof insecureRaw === 'string' &&
          ['1', 'true', 'yes'].includes(insecureRaw.trim().toLowerCase()));
      const r = await testDawateConnection({
        baseUrl: p.baseUrl,
        appId: pick(headers['appId']),
        appSecret: apiKey || undefined,
        insecureSkipVerify,
      });
      const base = (p.baseUrl || '').replace(/\/+$/, '');
      sendJson(res, {
        data: {
          provider: p.name,
          results: [
            {
              url: `${base}/knowledgeService/extSecret/generateAppKey`,
              latency: r.ok ? r.latencyMs : undefined,
              status: r.status,
              error: r.ok ? undefined : r.error,
            },
          ],
        },
      });
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

export async function handleProviderModels(
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
    const { providerManager } = await import('../providers/ProviderManager.js');
    const { fetchModels, isLocalProvider } =
      await import('../providers/ModelFetcher.js');
    await providerManager.initialize();
    const p = await providerManager.getProvider(id);
    if (!p) {
      sendError(res, '供应商不存在', 404);
      return;
    }

    // 本地供应商跳过 API Key 校验
    // 云供应商需要 API Key（除非 requiresAuth 为 false）
    const isLocal = isLocalProvider(p.providerType);
    const realKey = resolveRealApiKey(p);
    if (!isLocal && p.requiresAuth && !realKey) {
      sendError(res, '供应商需要 API Key 但未设置', 400);
      return;
    }

    const apiKey = p.requiresAuth ? realKey : '';
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
