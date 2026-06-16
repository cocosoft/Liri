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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO });

// ========== MCPMarketplace Handlers ==========

export async function handleMCPMarketplaceSearch(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const query = parsedUrl.searchParams.get('query') || '';
      const category = parsedUrl.searchParams.get('category') || undefined;
      const registry =
        (parsedUrl.searchParams.get('registry') as any) || undefined;
      const sourceRegistry =
        (parsedUrl.searchParams.get('sourceRegistry') as any) || undefined;

      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const results = await mcpSystem.marketplace.search({
        query,
        category,
        registry,
        sourceRegistry,
      });

      if (!results || !Array.isArray(results)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([]));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(results));
    } catch (err) {
      await handleError(err, { module: 'infra:mcp', action: 'search_marketplace' });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '搜索失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取 MCP 市场注册表列表 GET /v1/mcp/marketplace/registries
   * 返回可用第三方注册表源（GitHub/NPM/Smithery 等）
   */
export async function handleMCPMarketplaceRegistries(
  ctx: HandlerCtx,
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const marketplace = mcpSystem.marketplace;
      if (!marketplace.registryHub) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: '注册表中心未初始化' } }));
        return;
      }

      const adapters = marketplace.registryHub.getAdapters();
      if (!adapters || !Array.isArray(adapters)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ registries: [] }));
        return;
      }

      const registries = adapters
        .filter((a) => a && a.registryType === 'third_party')
        .map((a) => ({
          id: (a.sourceRegistry as string) || a.id,
          name: a.displayName || 'Unknown',
          sourceRegistry: a.sourceRegistry,
        }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ registries }));
    } catch (err) {
      await handleError(err, { module: 'infra:mcp', action: 'get_registries' });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取注册表列表失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取 MCP 市场分类请求 GET /v1/mcp/marketplace/categories
   */
export async function handleMCPMarketplaceCategories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const categories = await mcpSystem.marketplace.getCategories();

      if (!categories || !Array.isArray(categories)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([]));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(categories));
    } catch (err) {
      await handleError(err, { module: 'infra:mcp', action: 'get_categories' });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取分类列表失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取 MCP 服务器详情请求 GET /v1/mcp/marketplace/servers/:serverId
   */
export async function handleMCPMarketplaceServerDetail(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const detail = await mcpSystem.marketplace.getServerDetail(serverId);

      if (!detail) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Server not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detail));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'mcp_server_detail' });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取服务器详情失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取已安装 MCP 服务器列表 GET /v1/mcp/marketplace/installed
   */
export async function handleMCPInstalledServers(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const servers = mcpSystem.marketplace.getInstalledServers();
      if (!servers || !Array.isArray(servers)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([]));
        return;
      }

      const detailed = servers.map((s) => {
        const detail = mcpSystem.marketplace.getInstalledServerDetail(s.name);
        return {
          ...s,
          connected: detail.connected,
          configInFile: detail.config ? true : false,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detailed));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'mcp_installed_servers' });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取已安装服务器列表失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理安装 MCP 服务器请求 POST /v1/mcp/marketplace/servers/:serverId/install
   */
export async function handleMCPInstallServer(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.install(serverId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'mcp_install_server', context: { serverId } });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: `安装服务器失败: ${serverId}`,
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理卸载 MCP 服务器请求 POST /v1/mcp/marketplace/servers/:serverId/uninstall
   */
export async function handleMCPUninstallServer(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.uninstall(serverId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'mcp_uninstall_server', context: { serverId } });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: `卸载服务器失败: ${serverId}`,
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理切换 MCP 服务器启用状态 POST /v1/mcp/marketplace/servers/:serverId/toggle
   */
export async function handleMCPToggleServer(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;

      if (enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.toggleServer(serverId, enabled);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId, enabled }));
    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'mcp_toggle_server', context: { serverId } });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: `切换服务器状态失败: ${serverId}`,
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理验证 MCP 服务器连接 POST /v1/mcp/servers/:serverId/verify
   */
export async function handleMCPVerifyServer(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const { mcpSystem } = await import('@modules/services/mcp');

      const manager = getMCPServerManager();
      const detail = mcpSystem.marketplace.getInstalledServerDetail(serverId);

      if (!detail.metadata) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: `服务器 "${serverId}" 未安装`,
          })
        );
        return;
      }

      const server = manager.getServer(serverId);
      if (!server) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            success: false,
            connected: false,
            status: 'not_found',
          })
        );
        return;
      }

      // 尝试连接
      const wasConnected = detail.connected;
      const success = await server.connect();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success,
          connected: success,
          status: success ? 'connected' : 'failed',
          wasConnected,
        })
      );
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          connected: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  /**
   * 处理列出所有 MCP 工具 GET /v1/mcp/tools
   */
export async function handleMCPListTools(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const { mcpSystem } = await import('@modules/services/mcp');
      const manager = getMCPServerManager();
      const serverInfos = manager.getServerInfos();

      const tools: Array<{
        name: string;
        description: string;
        server: string;
        inputSchema: Record<string, unknown>;
        enabled: boolean;
      }> = [];

      for (const info of serverInfos) {
        for (const tool of info.tools || []) {
          const enabled = !mcpSystem.marketplace.isToolDisabled(
            info.name,
            tool.name
          );
          tools.push({
            name: tool.name,
            description: tool.description || '',
            server: info.name,
            inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
            enabled,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ tools, total: tools.length }));
    } catch (err) {
    }
  }

  /**
   * 处理切换 MCP 工具启用状态 PATCH /v1/mcp/tools/:toolName/toggle
   * body: { enabled: boolean, server?: string }
   */
export async function handleMCPToggleTool(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    toolName: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;
      const serverName = parsedBody.server as string | undefined;

      if (enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      // 工具级启用/禁用通过 marketplace 的 tool toggle 实现
      const { mcpSystem } = await import('@modules/services/mcp');
      await mcpSystem.marketplace.toggleTool(
        serverName || toolName,
        toolName,
        enabled
      );

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, tool: toolName, enabled }));
    } catch (err) {
    }
  }
