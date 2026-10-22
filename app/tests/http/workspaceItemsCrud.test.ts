/**
 * 工作项 CRUD 补验（2026-10-23，承接 §31.2 的「工作项跳过」与 §32.2 的 ⏳）
 *
 * 为什么此前跳过：探针用隔离实例（只有 HTTP、无工作空间注册表）⇒
 * `resolveWorkspacePath()` 一律 null。本次改为在**临时目录里注册一个真实工作空间**
 * （`LIRI_HOME/workspaces.json` + `<ws>/.workspace.json`），直接走
 * `dispatchWorkspaceRoutes` 做端到端 CRUD。
 *
 * 过程中发现并修掉一个真实缺陷：前端 `workspaceService.deleteWorkItem` 一直打
 * `DELETE /v1/workspaces/:id/items/:itemId`，而后端**没有该路由**（通用
 * `DELETE /v1/workspaces/:id` 的 `(.+)` 还会吞掉多段路径）⇒ UI 删除工作项必然失败。
 * 本用例锁住：删除命中工作项、且**不会**误删工作空间。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type http from 'http';

import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import { dispatchWorkspaceRoutes } from '../../src/infrastructure/http/handlers/routes/workspace-routes';

const WORKSPACE_ID = 'ws_verify_01';
const WORKSPACE_NAME = 'verify-ws';

let root: string;
let wsPath: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ws-items-'));
  const home = join(root, 'home');
  const data = join(root, 'data');
  mkdirSync(home, { recursive: true });
  mkdirSync(data, { recursive: true });

  process.env.LIRI_HOME = home;
  process.env.LIRI_DATA_DIR = data;

  wsPath = join(root, 'verify-ws');
  mkdirSync(wsPath, { recursive: true });

  const now = new Date().toISOString();
  writeFileSync(
    join(home, 'workspaces.json'),
    JSON.stringify(
      {
        workspaces: { [WORKSPACE_NAME]: wsPath },
        defaultRoot: join(root, 'workspaces'),
        activeWorkspace: WORKSPACE_NAME,
      },
      null,
      2
    )
  );
  writeFileSync(
    join(wsPath, '.workspace.json'),
    JSON.stringify(
      {
        id: WORKSPACE_ID,
        name: WORKSPACE_NAME,
        createdAt: now,
        updatedAt: now,
        description: 'work item CRUD 验证',
      },
      null,
      2
    )
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.LIRI_HOME;
  delete process.env.LIRI_DATA_DIR;
});

function makeReq(method: string, body?: unknown): http.IncomingMessage {
  const json = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    url: '/',
    headers: {},
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data') cb(Buffer.from(json));
      if (event === 'end') queueMicrotask(() => cb());
      return this;
    },
  } as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  status: () => number;
  body: () => string;
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
    on: () => undefined,
    write: () => true,
    socket: null,
    headersSent: false,
  } as unknown as http.ServerResponse;
  return { res, status: () => out.status, body: () => out.body };
}

const ctx = {
  readRequestBody,
  broadcastEvent: () => {},
} as unknown as HandlerCtx;

async function dispatch(
  method: string,
  url: string,
  body?: unknown
): Promise<{ matched: boolean; status: number; json: unknown }> {
  const { res, status, body: raw } = makeRes();
  const matched = await dispatchWorkspaceRoutes(
    makeReq(method, body),
    res,
    url,
    () => {},
    ctx
  );
  const text = raw();
  return {
    matched,
    status: status(),
    json: text ? JSON.parse(text) : null,
  };
}

describe('工作项 CRUD（临时工作空间，真端口 + 真路由）', () => {
  let itemId = '';

  it('POST ⇒ 201 并返回工作项', async () => {
    const result = await dispatch(
      'POST',
      `/v1/workspaces/${WORKSPACE_ID}/items`,
      { title: '补验工作项', type: 'task', priority: 'high' }
    );

    expect(result.matched).toBe(true);
    expect(result.status).toBe(201);
    const item = result.json as { id: string; title: string };
    expect(item.title).toBe('补验工作项');
    expect(item.id).toBeTruthy();
    itemId = item.id;
  });

  it('GET ⇒ 列表可见刚创建的工作项', async () => {
    const result = await dispatch(
      'GET',
      `/v1/workspaces/${WORKSPACE_ID}/items`
    );

    expect(result.status).toBe(200);
    const items = result.json as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toContain(itemId);
  });

  it('PATCH ⇒ 状态更新后重读生效', async () => {
    const patched = await dispatch(
      'PATCH',
      `/v1/workspaces/${WORKSPACE_ID}/items/${itemId}`,
      { status: 'done' }
    );
    expect(patched.status).toBe(200);

    const listed = await dispatch(
      'GET',
      `/v1/workspaces/${WORKSPACE_ID}/items`
    );
    const items = listed.json as Array<{ id: string; status: string }>;
    expect(items.find((i) => i.id === itemId)?.status).toBe('done');
  });

  it('PATCH 非法状态 ⇒ 400（既有校验不回归）', async () => {
    const result = await dispatch(
      'PATCH',
      `/v1/workspaces/${WORKSPACE_ID}/items/${itemId}`,
      { status: 'not-a-status' }
    );

    expect(result.status).toBe(400);
  });

  it('DELETE ⇒ 200 且列表消失；工作空间本身仍存在（路由顺序正确）', async () => {
    const deleted = await dispatch(
      'DELETE',
      `/v1/workspaces/${WORKSPACE_ID}/items/${itemId}`
    );

    expect(deleted.status).toBe(200);
    expect((deleted.json as { deleted: boolean }).deleted).toBe(true);

    const listed = await dispatch(
      'GET',
      `/v1/workspaces/${WORKSPACE_ID}/items`
    );
    const items = listed.json as Array<{ id: string }>;
    expect(items.map((i) => i.id)).not.toContain(itemId);

    // 通用 `DELETE /v1/workspaces/:id` 不得被误命中
    expect(existsSync(join(wsPath, '.workspace.json'))).toBe(true);
  });

  it('DELETE 不存在的工作项 ⇒ 404', async () => {
    const result = await dispatch(
      'DELETE',
      `/v1/workspaces/${WORKSPACE_ID}/items/no-such-item`
    );

    expect(result.status).toBe(404);
  });

  it('未知工作空间 ⇒ 404（负向路径）', async () => {
    const result = await dispatch('POST', '/v1/workspaces/ws_missing/items', {
      title: 'x',
    });

    expect(result.status).toBe(404);
  });

  it('缺 title ⇒ 400（既有校验不回归）', async () => {
    const result = await dispatch(
      'POST',
      `/v1/workspaces/${WORKSPACE_ID}/items`,
      { description: 'no title' }
    );

    expect(result.status).toBe(400);
  });
});
