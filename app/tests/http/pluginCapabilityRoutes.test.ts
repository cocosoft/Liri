// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2 · 能力端点接线守卫（2026-10-25）
//
// 为什么用源码级断言：这两条路径的正则与 `plugins/{id}` 详情路由**前缀重叠**，
// 顺序写反不会编译失败、也不会被类型检查发现，只会让 `GET .../x/capabilities`
// 被当成 pluginId = "x/capabilities" 的详情请求（静默 404/错数据）。
// 行为测试需要起 HTTP 与桩掉 CoreAPI；这里用「顺序 + 鉴权」两条最小断言钉住接线。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/marketplace-mcp-routes.ts',
    import.meta.url
  ),
  'utf8'
);
const ROUTE_TABLE = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/route-table.ts',
    import.meta.url
  ),
  'utf8'
);
// W26-15（2026-10-26）：管理写判定下沉到该模块（纯函数 + 数据声明表）
const ADMIN_WRITE_ROUTES = readFileSync(
  new URL('../../src/infrastructure/http/adminWriteRoutes.ts', import.meta.url),
  'utf8'
);

describe('能力端点接线', () => {
  it('GET / PUT 两条能力路由都已注册', () => {
    expect(ROUTES).toContain('handlePluginCapabilityState');
    expect(ROUTES).toContain('handlePluginSetCapabilityGrants');
    expect(ROUTES).toContain("method === 'PUT'");
  });

  it('能力路由必须排在 `plugins/{id}` 详情路由之前（否则前缀被吞）', () => {
    const capabilitiesAt = ROUTES.indexOf('/capabilities$');
    const detailAt = ROUTES.indexOf(
      'url.match(/^\\/v1\\/plugins\\/marketplace\\/plugins\\/(.+)$/)'
    );
    expect(capabilitiesAt).toBeGreaterThan(-1);
    expect(detailAt).toBeGreaterThan(-1);
    expect(capabilitiesAt).toBeLessThan(detailAt);
  });

  it('能力授权写入（PUT）纳入 admin 写鉴权', () => {
    // 断言「注册表确实消费该判定」+「规则点名了该路径」两条
    // （只卡这一条，不影响插件安装/卸载）
    expect(ROUTE_TABLE).toContain('isAdminWriteRoute(method, url)');
    expect(ADMIN_WRITE_ROUTES).toContain("'/capabilities'");
  });
});
