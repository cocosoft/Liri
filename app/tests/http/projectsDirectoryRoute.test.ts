/**
 * P2（2026-11-03）：`/v1/settings/projects-directory` 路由契约 + **路由顺序**回归
 *
 * 为什么必须测顺序：通用分支 `/^\/v1\/settings\/(.+)$/` 会吞掉所有具体端点。
 * 同一处曾把 `/v1/settings/data-directory` 排在通用分支之后 ⇒ 设置页的读写实际落到
 * 通用 `handleGet/SetSettings`（写 `settings.data-directory` 配置键而非 `settings.json`）⇒ 保存不生效。
 * 本测试同时锁住**新端点可达**与**响应形状不是通用 `{namespace}`**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type http from 'http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { dispatchConfigSkillsRoutes } from '../../src/infrastructure/http/handlers/routes/config-skills-routes';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { setUserDataDirOverride } from '@openliri/infra/environment';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'projects-route-'));
  setUserDataDirOverride(home);
});

afterEach(() => {
  setUserDataDirOverride(null);
  rmSync(home, { recursive: true, force: true });
});

function createReq(
  method: string,
  url: string,
  jsonBody?: unknown
): http.IncomingMessage {
  const payload = jsonBody === undefined ? '' : JSON.stringify(jsonBody);
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  return {
    method,
    url,
    on: (event: string, cb: (arg?: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'end') {
        queueMicrotask(() => {
          for (const h of handlers['data'] ?? []) h(Buffer.from(payload));
          for (const h of handlers['end'] ?? []) h();
        });
      }
    },
  } as unknown as http.IncomingMessage;
}

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

const ctx = {
  readRequestBody: (req: http.IncomingMessage): Promise<string> =>
    new Promise<string>((resolveBody) => {
      let data = '';
      req.on('data', (chunk) => {
        data += String(chunk);
      });
      req.on('end', () => resolveBody(data));
    }),
  sendError: (res: http.ServerResponse, err: unknown): void => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  },
} as unknown as HandlerCtx;

async function call(
  method: string,
  url: string,
  jsonBody?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, read } = createRes();
  const matched = await dispatchConfigSkillsRoutes(
    createReq(method, url, jsonBody),
    res,
    url,
    () => {},
    ctx
  );
  expect(matched).toBe(true);
  return read();
}

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(
      readFileSync(join(home, 'settings.json'), 'utf-8')
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('/v1/settings/projects-directory（P2）', () => {
  it('GET ⇒ 具体端点响应（含 defaultDirectory），不是通用 {namespace}', async () => {
    const { status, body } = await call(
      'GET',
      '/v1/settings/projects-directory'
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty('defaultDirectory');
    expect(body).toHaveProperty('currentDirectory');
    expect(body).not.toHaveProperty('namespace');
  });

  it('PUT 合法目录 ⇒ 落 settings.json#projectsDirectory，并返回已配置值', async () => {
    const target = join(home, 'my-projects');
    const { status, body } = await call(
      'PUT',
      '/v1/settings/projects-directory',
      {
        directory: target,
      }
    );

    expect(status).toBe(200);
    expect(body.configuredDirectory).toBe(resolve(target));
    expect(readSettings()['projectsDirectory']).toBe(resolve(target));
  });

  it('PUT 空目录 ⇒ 恢复默认（删除设置键，不删文件）', async () => {
    await call('PUT', '/v1/settings/projects-directory', {
      directory: join(home, 'tmp-projects'),
    });
    const { status, body } = await call(
      'PUT',
      '/v1/settings/projects-directory',
      { directory: '' }
    );

    expect(status).toBe(200);
    expect(body.configuredDirectory).toBeNull();
    expect(readSettings()['projectsDirectory']).toBeUndefined();
  });

  it('PUT 指向已有文件 ⇒ 400（存在 ≠ 可作目录）', async () => {
    const filePath = join(home, 'a-file.txt');
    writeFileSync(filePath, 'x', 'utf-8');
    const { status } = await call('PUT', '/v1/settings/projects-directory', {
      directory: filePath,
    });
    expect(status).toBe(400);
  });

  it('数据目录端点也走具体处理器（顺序回归）', async () => {
    const { body } = await call('GET', '/v1/settings/data-directory');
    expect(body).toHaveProperty('currentDirectory');
    expect(body).not.toHaveProperty('namespace');
  });
});
