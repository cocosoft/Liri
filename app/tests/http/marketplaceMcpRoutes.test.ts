// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 市场路由清单守卫（P3-2，2026-11-16）
//
// 为什么用源码级断言：`dispatchMarketplaceMcpRoutes` 是一张「顺序即语义」的路由表，
// 匹配顺序写反不会编译失败，只会静默 404 / 错数据（与 pluginConfigRoutes 同因）。
// 行为测试需起 HTTP 并桩掉 CoreAPI，而本仓门禁禁止 `mock.module` ⇒ 用「清单齐全 +
// 无重复注册 + 插件段在 MCP 段之后 + 兜底 false」四条钉住外移前后的等价性。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/marketplace-mcp-routes.ts',
    import.meta.url
  ),
  'utf8'
);

/** MCP 市场：路由片段 → 唯一 handler */
const MCP_MARKETPLACE_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["'/v1/mcp/marketplace/search'", 'handleMCPMarketplaceSearch'],
  ["'/v1/mcp/marketplace/registries'", 'handleMCPMarketplaceRegistries'],
  ["'/v1/mcp/marketplace/categories'", 'handleMCPMarketplaceCategories'],
  [
    '/^\\/v1\\/mcp\\/marketplace\\/servers\\/(.+)$/',
    'handleMCPMarketplaceServerDetail',
  ],
  ["'/v1/mcp/marketplace/installed'", 'handleMCPInstalledServers'],
  [
    '/^\\/v1\\/mcp\\/marketplace\\/servers\\/(.+)\\/install$/',
    'handleMCPInstallServer',
  ],
  [
    '/^\\/v1\\/mcp\\/marketplace\\/servers\\/(.+)\\/uninstall$/',
    'handleMCPUninstallServer',
  ],
  [
    '/^\\/v1\\/mcp\\/marketplace\\/servers\\/(.+)\\/toggle$/',
    'handleMCPToggleServer',
  ],
];

/** MCP 其余端点（verify / oauth / tools） */
const MCP_OTHER_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['/^\\/v1\\/mcp\\/servers\\/(.+)\\/verify$/', 'handleMCPVerifyServer'],
  ["'/v1/mcp/oauth/callback'", 'handleMCPOAuthCallback'],
  ["'/v1/mcp/tools'", 'handleMCPListTools'],
  ['/^\\/v1\\/mcp\\/tools\\/(.+)\\/toggle$/', 'handleMCPToggleTool'],
];

describe('marketplace-mcp 路由清单', () => {
  /** 每个 handler 恰好出现两次：一次解构取用，一次调用 —— 多则重复注册 */
  const expectRegisteredOnce = (handler: string) => {
    expect(ROUTES.split(handler).length - 1).toBe(2);
  };

  it('MCP 市场 8 条路由与 handler 一一对应且只注册一次', () => {
    for (const [route, handler] of MCP_MARKETPLACE_ROUTES) {
      expect(ROUTES).toContain(route);
      expectRegisteredOnce(handler);
    }
  });

  it('MCP verify / oauth / tools 端点仍在（外移不得丢条目）', () => {
    for (const [route, handler] of MCP_OTHER_ROUTES) {
      expect(ROUTES).toContain(route);
      expectRegisteredOnce(handler);
    }
  });

  it('插件市场段排在 MCP 市场段之后（顺序即语义）', () => {
    const mcpAt = ROUTES.indexOf('handleMCPMarketplaceSearch');
    const pluginAt = ROUTES.indexOf('handlePluginMarketplaceSearch');
    expect(mcpAt).toBeGreaterThan(-1);
    expect(pluginAt).toBeGreaterThan(-1);
    expect(mcpAt).toBeLessThan(pluginAt);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
