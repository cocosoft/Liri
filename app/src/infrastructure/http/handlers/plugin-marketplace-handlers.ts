/**
 * plugin-marketplace-handlers.ts — 插件市场 HTTP 处理器（2026-08-06 新增，J-13）
 *
 * 服务对象为 Liri 应用插件（PluginMarketplace / NpmDistributor / PluginSystem），
 * 与 MCP 市场（services/mcp/marketplace，服务 MCP 协议服务器）不同。
 * 端点前缀：/v1/plugins/marketplace/*
 */

import type http from 'http';
import { sendError } from './handler-utils';
import { handleError } from '@modules/error';

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
      `http://${req.headers.host || 'localhost'}`
    );
    const query = parsedUrl.searchParams.get('query') || '';
    const page = Number(parsedUrl.searchParams.get('page') || '1') || 1;
    const pageSize =
      Number(parsedUrl.searchParams.get('pageSize') || '20') || 20;

    const { pluginMarketplace } = await import('@modules/plugins/marketplace');
    const result = pluginMarketplace.search({ query, page, pageSize });

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
    const { pluginMarketplace } = await import('@modules/plugins/marketplace');
    const categories = pluginMarketplace.getCategories();
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
    const { pluginSystem } = await import('@modules/plugins');
    const plugins = pluginSystem.getPluginInfoList();
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
    const { pluginSystem } = await import('@modules/plugins');
    // 刷新超时标记后返回快照
    pluginSystem.checkPendingSdkTimeouts();
    const pending = pluginSystem.getPendingSdkPlugins();
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
 * 处理插件详情 GET /v1/plugins/marketplace/plugins/:id
 */
export async function handlePluginMarketplaceDetail(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  pluginId: string
): Promise<void> {
  try {
    const { pluginMarketplace } = await import('@modules/plugins/marketplace');
    const plugin = pluginMarketplace.getPlugin(pluginId);
    const versions = pluginMarketplace.getPluginVersions(pluginId);

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
    const { NpmDistributor } = await import('@modules/plugins/distribution');
    const { pluginSystem } = await import('@modules/plugins');

    const distributor = new NpmDistributor();
    const installResult = await distributor.install(pluginId);

    if (!installResult.success) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: installResult.error } }));
      return;
    }

    // 尝试加载进插件系统（npm 包若含 plugin.json 清单则注册成功，否则仅落盘）
    let loaded = false;
    try {
      const loadResult = await pluginSystem.loadPlugin(pluginId);
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
    const { NpmDistributor } = await import('@modules/plugins/distribution');
    const { pluginSystem } = await import('@modules/plugins');

    try {
      await pluginSystem.stopPlugin(pluginId);
      await pluginSystem.unloadPlugin(pluginId);
    } catch {
      // @ignore-catch: 插件未加载时忽略（卸载不存在的插件为预期场景）
    }

    const distributor = new NpmDistributor();
    const removed = await distributor.remove(pluginId);

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
