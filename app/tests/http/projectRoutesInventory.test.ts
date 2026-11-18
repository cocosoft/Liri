// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// project 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchProjectRoutes` 是「顺序即语义」的路由表：`/v1/projects/migrate` 必须先于
// `/v1/projects/:id`，`/context` / `/files` / `/artifacts` 等子资源必须先于单项目路由
// （否则 `(.+)` 会把子路径当成 projectId）；写反不会编译失败，只会静默错配。
// 本表用「每个 handler 只调用一次 + 源码内调用顺序」钉住外移前后的等价性。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/project-routes.ts',
    import.meta.url
  ),
  'utf8'
);

/** 源码内的调用顺序（与匹配顺序一一对应） */
const CALL_ORDER = [
  // 旧链路（/v1/workspaces/:id/projects…）
  'handleWsListProjects',
  'handleGetTemplates',
  'handleGetProjectBoard',
  'handleGetProjectRules',
  'handleWsGetProject',
  // 新链路集合级
  'handleListProjects',
  'handleCreateProject',
  'handleMigrateProjects',
  'handleMigrateFiles',
  'handleRelocateProject',
  'handleSetProjectAutonomy',
  // 新链路子资源
  'handleGetProjectContext',
  'handleSaveProjectContext',
  'handleEngineHook',
  'handleGetProjectHistory',
  'handleGetSummaries',
  'handleListProjectFiles',
  'handleUploadProjectFile',
  'handleDeleteProjectFile',
  'handleListArtifacts',
  'handleSaveArtifact',
  'handleDeleteArtifact',
  // 新链路单项目
  'handleGetProject',
  'handleUpdateProject',
  'handleDeleteProject',
] as const;

describe('project 路由清单', () => {
  it('25 个 handler 各被调用一次（漏项 = 路由丢失）', () => {
    for (const handler of CALL_ORDER) {
      expect(ROUTES.split(`await ${handler}(`).length - 1).toBe(1);
    }
  });

  it('调用顺序与匹配顺序一致（顺序即语义）', () => {
    const positions = CALL_ORDER.map((h) => ROUTES.indexOf(`await ${h}(`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('迁移路由先于单项目路由（否则 migrate 被当成 projectId）', () => {
    const migrate = ROUTES.indexOf("url === '/v1/projects/migrate'");
    const single = ROUTES.indexOf('/^\\/v1\\/projects\\/(.+)$/');
    expect(migrate).toBeGreaterThan(-1);
    expect(single).toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(single);
  });

  it('三条旧写路由仍以 410 阻断写入（不落回旧 store）', () => {
    expect(ROUTES.split('json(res, 410').length - 1).toBe(3);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
