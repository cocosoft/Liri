// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 插件配置端点接线守卫（2026-10-26）
//
// 为什么用源码级断言：与能力端点同样的前缀重叠风险 —— `plugins/{id}` 详情路由的
// `(.+)` 会把 `id/config` 整个当成 pluginId；顺序写反不会编译失败，只会静默 404/错数据。
// 行为测试需要起 HTTP 与桩掉 CoreAPI，这里用「注册 + 顺序 + 鉴权 + 400 口径」四条最小断言钉住。
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
const HANDLERS = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/plugin-marketplace-handlers.ts',
    import.meta.url
  ),
  'utf8'
);

describe('插件配置端点接线', () => {
  it('GET / PUT 两条配置路由都已注册', () => {
    expect(ROUTES).toContain('handlePluginGetConfig');
    expect(ROUTES).toContain('handlePluginSetConfig');
  });

  it('配置路由必须排在 `plugins/{id}` 详情路由之前（否则前缀被吞）', () => {
    const configAt = ROUTES.indexOf('/config$');
    const detailAt = ROUTES.indexOf(
      'url.match(/^\\/v1\\/plugins\\/marketplace\\/plugins\\/(.+)$/)'
    );
    expect(configAt).toBeGreaterThan(-1);
    expect(detailAt).toBeGreaterThan(-1);
    expect(configAt).toBeLessThan(detailAt);
  });

  it('配置写入（PUT）纳入 admin 写鉴权', () => {
    expect(ROUTE_TABLE).toContain("url.endsWith('/config')");
  });

  it('校验失败回 400 且带原因（不静默成功）', () => {
    expect(HANDLERS).toContain('配置校验失败：${result.errors.join');
    expect(HANDLERS).toContain('json(res, 400');
  });
});
