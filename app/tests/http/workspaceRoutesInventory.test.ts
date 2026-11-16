// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 工作空间路由清单守卫（P3-2，2026-11-16）
//
// `dispatchWorkspaceRoutes` 是「顺序即语义」的路由表：工作项删除必须先于通用
// `DELETE /v1/workspaces/:id`，任务 children 必须先于通用任务详情 —— 写反不会编译失败，
// 只会静默错配（既有 workspaceItemsCrud 端到端用例只覆盖工作项 CRUD）。
// 本表用「每个 handler 只调用一次 + 源码内调用顺序」钉住外移前后的等价性。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/workspace-routes.ts',
    import.meta.url
  ),
  'utf8'
);

/** 源码内的调用顺序（与匹配顺序一一对应） */
const CALL_ORDER = [
  'handleListWorkspaces',
  'handleDeleteWorkItem',
  'handleDeleteWorkspace',
  'handleListWorkspaceSessions',
  'handleCreateWorkspaceSession',
  'handleListWorkItems',
  'handleCreateWorkItem',
  'handleUpdateWorkItem',
  'handleListTaskChildren',
  'handleGetTask',
  'handleListTasks',
  'handleCreateTask',
  'handleUpdateTask',
  'handleDeleteTask',
  'handleDetectLiriDir',
  'handleInitLiriDir',
  'handleGetWorkspaceConfig',
  'handleUpdateWorkspaceConfig',
  'handleGetWorkspaceRules',
  'handleUpdateWorkspaceRules',
  'handleListChangeSets',
  'handleCreateChangeSet',
  'handleGetChangeSetSummary',
  'handleGetChangeSet',
  'handleAddFileChange',
  'handleUpdateChangeSet',
] as const;

describe('workspace 路由清单', () => {
  it('26 个 handler 各被调用一次（漏项 = 路由丢失）', () => {
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

  it('工作项删除先于通用工作空间删除（多段路径不被 (.+) 吞掉）', () => {
    const itemDelete = ROUTES.indexOf('/items\\/([^/]+)$/');
    const genericDelete = ROUTES.indexOf(
      "method === 'DELETE' && url.match(/^\\/v1\\/workspaces\\/(.+)$/)"
    );
    expect(itemDelete).toBeGreaterThan(-1);
    expect(genericDelete).toBeGreaterThan(-1);
    expect(itemDelete).toBeLessThan(genericDelete);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
