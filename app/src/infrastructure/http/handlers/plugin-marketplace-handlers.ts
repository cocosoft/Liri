/**
 * plugin-marketplace-handlers.ts — 插件市场 HTTP 处理器（2026-08-06 新增，J-13）
 *
 * 服务对象为 Liri 应用插件（PluginMarketplace / NpmDistributor / PluginSystem），
 * 与 MCP 市场（services/mcp/marketplace，服务 MCP 协议服务器）不同。
 * 端点前缀：/v1/plugins/marketplace/*
 */

import type http from 'http';
import { json, readBody, sendError } from './handler-utils';
import { handleError } from '@modules/error';
// C1（2026-09-30 D-92）：插件管理改经服务层端口（消除 service → app 跨层引用）
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { LOCAL_SERVICE_HOST } from '@openliri/kernel';

/**
 * 处理插件市场搜索 GET /v1/plugins/marketplace/search?query=xx&page=1&pageSize=20
 */
export async function handlePluginMarketplaceSearch(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const parsedUrl = new URL(
      req.url!,
      `http://${req.headers.host || LOCAL_SERVICE_HOST}`
    );
    const query = parsedUrl.searchParams.get('query') || '';
    const page = Number(parsedUrl.searchParams.get('page') || '1') || 1;
    const pageSize =
      Number(parsedUrl.searchParams.get('pageSize') || '20') || 20;

    const result = await (
      await getCoreAPI().getPluginAdminPort()
    ).searchMarket({ query, page, pageSize });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_marketplace_search',
    });
    sendError(res, err);
  }
}

/**
 * 处理插件市场分类 GET /v1/plugins/marketplace/categories
 */
export async function handlePluginMarketplaceCategories(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const categories = await (
      await getCoreAPI().getPluginAdminPort()
    ).getMarketCategories();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(categories));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_marketplace_categories',
    });
    sendError(res, err);
  }
}

/**
 * 处理已安装插件列表 GET /v1/plugins/marketplace/installed
 * 返回插件系统已加载/注册的插件（含内置插件）
 */
export async function handlePluginInstalledList(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const plugins = await (
      await getCoreAPI().getPluginAdminPort()
    ).getPluginInfoList();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(plugins));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_installed_list',
    });
    sendError(res, err);
  }
}

/**
 * 处理响应式挂起插件列表 GET /v1/plugins/marketplace/pending（4.4）
 * 返回因 inject 必需服务缺失而挂起等待的 SDK 插件（含缺失服务、超时状态）
 */
export async function handlePluginPendingList(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // 刷新超时标记后返回快照（2026-09-30 D-92：改经 CoreAPI 端口）
    const port = await getCoreAPI().getPluginAdminPort();
    await port.checkPendingSdkTimeouts();
    const pending = await port.getPendingSdkPlugins();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(pending));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_pending_list',
    });
    sendError(res, err);
  }
}

/**
 * 插件**能力状态** GET /v1/plugins/marketplace/plugins/:id/capabilities
 *
 * 返回清单声明的能力 / 已授权 / 缺失 / 未实现 / 可授权集合（市场页勾选授权用）。
 */
export async function handlePluginCapabilityState(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const state = await (
      await getCoreAPI().getPluginAdminPort()
    ).getPluginCapabilityState(pluginId);
    json(res, 200, state);
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_capability_state',
      context: { pluginId },
    });
    sendError(res, err);
  }
}

/**
 * 插件**能力授权** PUT /v1/plugins/marketplace/plugins/:id/capabilities
 *
 * 请求体 `{ granted: string[] }`：覆盖该插件的授权集合（空数组 = 收回全部）。
 * 只接受 `available`（已实现）里的名字 —— 未实现能力授权了也不会有提供面，直接 400。
 */
export async function handlePluginSetCapabilityGrants(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      json(res, 400, { error: { message: '请求体必须是 JSON' } });
      return;
    }
    const granted = (body as { granted?: unknown } | null)?.granted;
    if (
      !Array.isArray(granted) ||
      granted.some((item) => typeof item !== 'string')
    ) {
      json(res, 400, {
        error: { message: 'granted 必须是字符串数组（能力名）' },
      });
      return;
    }

    const port = await getCoreAPI().getPluginAdminPort();
    const current = await port.getPluginCapabilityState(pluginId);
    const available = new Set(current.available);
    const invalid = (granted as string[]).filter((cap) => !available.has(cap));
    if (invalid.length > 0) {
      json(res, 400, {
        error: {
          message: `不支持的能力：${invalid.join(', ')}（当前可用：${current.available.join(' / ')}）`,
        },
      });
      return;
    }

    const next = await port.setPluginCapabilityGrants(
      pluginId,
      granted as string[]
    );
    json(res, 200, next);
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_set_capability_grants',
      context: { pluginId },
    });
    sendError(res, err);
  }
}

/**
 * 插件**配置项** GET /v1/plugins/marketplace/plugins/:id/config
 *
 * 返回清单 schema 视图 + 已存储值（插件未加载 / 未声明 `configSchema` ⇒ `items` 为空，**不臆造**）。
 * 存储在 `~/.pyapp/plugins/config/config.json`（`PluginConfigManager`，唯一事实源）。
 */
export async function handlePluginGetConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const port = await getCoreAPI().getPluginAdminPort();
    json(res, 200, await port.getPluginConfig(pluginId));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_config_get',
      context: { pluginId },
    });
    sendError(res, err);
  }
}

/**
 * 插件**配置项** PUT /v1/plugins/marketplace/plugins/:id/config
 *
 * 请求体 `{ values: { ... } }`：**合并写入**（只覆盖请求里出现的键）。
 * 键存在性 / 类型 / 必填 / 范围校验不通过 ⇒ 400 且**不落盘**。
 */
export async function handlePluginSetConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      json(res, 400, { error: { message: '请求体必须是 JSON' } });
      return;
    }
    const values = (body as { values?: unknown } | null)?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      json(res, 400, {
        error: { message: 'values 必须是对象（配置键值对）' },
      });
      return;
    }

    const port = await getCoreAPI().getPluginAdminPort();
    const result = await port.setPluginConfig(
      pluginId,
      values as Record<string, unknown>
    );
    if (!result.ok) {
      json(res, 400, {
        error: { message: `配置校验失败：${result.errors.join('; ')}` },
      });
      return;
    }
    json(res, 200, result.config);
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_config_set',
      context: { pluginId },
    });
    sendError(res, err);
  }
}

/**
 * 处理插件详情 GET /v1/plugins/marketplace/plugins/:id
 */
export async function handlePluginMarketplaceDetail(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const port = await getCoreAPI().getPluginAdminPort();
    const plugin = await port.getMarketPlugin(pluginId);
    const versions = await port.getMarketPluginVersions(pluginId);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ plugin: plugin ?? null, versions }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_marketplace_detail',
      context: { pluginId },
    });
    sendError(res, err);
  }
}

/**
 * 处理插件安装 POST /v1/plugins/marketplace/plugins/:id/install
 * 落盘（NpmDistributor）→ 尝试加载进插件系统（有 plugin.json 时成功）
 */
export async function handlePluginInstall(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const port = await getCoreAPI().getPluginAdminPort();
    const installResult = await port.installPackage(pluginId);

    if (!installResult.success) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: installResult.error } }));
      return;
    }

    // 尝试加载进插件系统（npm 包若含 plugin.json 清单则注册成功，否则仅落盘）
    let loaded = false;
    try {
      const loadResult = await port.loadPlugin(pluginId);
      loaded = loadResult.success;
    } catch {
      loaded = false;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: true,
        name: installResult.name,
        version: installResult.version,
        loaded,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_install',
      context: { pluginId },
    });
    sendError(res, err);
  }
}

/**
 * 处理插件卸载 POST /v1/plugins/marketplace/plugins/:id/uninstall
 * 停用/卸载（PluginSystem）→ 移除包（NpmDistributor）
 */
export async function handlePluginUninstall(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const port = await getCoreAPI().getPluginAdminPort();

    try {
      await port.stopAndUnloadPlugin(pluginId);
    } catch {
      // @ignore-catch: 插件未加载时忽略（卸载不存在的插件为预期场景）
    }

    const removed = await port.removePackage(pluginId);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: removed, name: pluginId }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'plugin_uninstall',
      context: { pluginId },
    });
    sendError(res, err);
  }
}
