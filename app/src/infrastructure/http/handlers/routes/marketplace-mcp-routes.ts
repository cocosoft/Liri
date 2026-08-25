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
 * marketplace-mcp-routes.ts — dispatchMarketplaceMcpRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';

/**
 * dispatchMarketplaceMcpRoutes — marketplace-mcp-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchMarketplaceMcpRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- MCP Marketplace（P1-1：切 mcp-marketplace-handlers 纯函数，消除与 LocalHTTPService 内联的双份实现） ----
  if (method === 'GET' && url === '/v1/mcp/marketplace/search') {
    const { handleMCPMarketplaceSearch } =
      await import('../mcp-marketplace-handlers');
    await handleMCPMarketplaceSearch(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/mcp/marketplace/registries') {
    const { handleMCPMarketplaceRegistries } =
      await import('../mcp-marketplace-handlers');
    await handleMCPMarketplaceRegistries(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/mcp/marketplace/categories') {
    const { handleMCPMarketplaceCategories } =
      await import('../mcp-marketplace-handlers');
    await handleMCPMarketplaceCategories(req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)$/)
  ) {
    const { handleMCPMarketplaceServerDetail } =
      await import('../mcp-marketplace-handlers');
    await handleMCPMarketplaceServerDetail(
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/mcp/marketplace/installed') {
    const { handleMCPInstalledServers } =
      await import('../mcp-marketplace-handlers');
    await handleMCPInstalledServers(req, res);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/install$/)
  ) {
    const { handleMCPInstallServer } =
      await import('../mcp-marketplace-handlers');
    await handleMCPInstallServer(
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/install$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/uninstall$/)
  ) {
    const { handleMCPUninstallServer } =
      await import('../mcp-marketplace-handlers');
    await handleMCPUninstallServer(
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/uninstall$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/toggle$/)
  ) {
    const { handleMCPToggleServer } =
      await import('../mcp-marketplace-handlers');
    await handleMCPToggleServer(
      req,
      res,
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/toggle$/)![1]
    );
    return true;
  }

  // ---- Plugin Marketplace（2026-08-06 新增：Liri 应用插件市场，J-13） ----
  if (method === 'GET' && url === '/v1/plugins/marketplace/search') {
    const { handlePluginMarketplaceSearch } =
      await import('../plugin-marketplace-handlers');
    await handlePluginMarketplaceSearch(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/plugins/marketplace/categories') {
    const { handlePluginMarketplaceCategories } =
      await import('../plugin-marketplace-handlers');
    await handlePluginMarketplaceCategories(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/plugins/marketplace/installed') {
    const { handlePluginInstalledList } =
      await import('../plugin-marketplace-handlers');
    await handlePluginInstalledList(req, res);
    return true;
  }
  // 4.4：响应式挂起的 SDK 插件列表（inject 必需服务缺失等待中）
  if (method === 'GET' && url === '/v1/plugins/marketplace/pending') {
    const { handlePluginPendingList } =
      await import('../plugin-marketplace-handlers');
    await handlePluginPendingList(req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/plugins\/marketplace\/plugins\/(.+)$/)
  ) {
    const { handlePluginMarketplaceDetail } =
      await import('../plugin-marketplace-handlers');
    await handlePluginMarketplaceDetail(
      req,
      res,
      url.match(/^\/v1\/plugins\/marketplace\/plugins\/(.+)$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/plugins\/marketplace\/plugins\/(.+)\/install$/)
  ) {
    const { handlePluginInstall } =
      await import('../plugin-marketplace-handlers');
    await handlePluginInstall(
      req,
      res,
      url.match(/^\/v1\/plugins\/marketplace\/plugins\/(.+)\/install$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/plugins\/marketplace\/plugins\/(.+)\/uninstall$/)
  ) {
    const { handlePluginUninstall } =
      await import('../plugin-marketplace-handlers');
    await handlePluginUninstall(
      req,
      res,
      url.match(/^\/v1\/plugins\/marketplace\/plugins\/(.+)\/uninstall$/)![1]
    );
    return true;
  }

  // ---- MCP Server Verify ----
  if (method === 'POST' && url.match(/^\/v1\/mcp\/servers\/(.+)\/verify$/)) {
    const { handleMCPVerifyServer } =
      await import('../mcp-marketplace-handlers');
    await handleMCPVerifyServer(
      req,
      res,
      url.match(/^\/v1\/mcp\/servers\/(.+)\/verify$/)![1]
    );
    return true;
  }

  // ---- MCP OAuth Callback ----
  if (method === 'GET' && url.startsWith('/v1/mcp/oauth/callback')) {
    const { handleMCPOAuthCallback } = await import('../mcp-oauth-handler');
    await handleMCPOAuthCallback(req, res);
    return true;
  }

  // ---- MCP Tools ----
  if (method === 'GET' && url === '/v1/mcp/tools') {
    const { handleMCPListTools } = await import('../mcp-marketplace-handlers');
    await handleMCPListTools(req, res);
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/mcp\/tools\/(.+)\/toggle$/)) {
    const { handleMCPToggleTool } = await import('../mcp-marketplace-handlers');
    await handleMCPToggleTool(
      req,
      res,
      url.match(/^\/v1\/mcp\/tools\/(.+)\/toggle$/)![1]
    );
    return true;
  }
  return false;
}
