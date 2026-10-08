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
 * AI-VFS 挂载管理 HTTP 端点（冻结契约：`.trae/specs/ai-vfs-user-mountable.md §8.2`）。
 *
 * 覆盖：
 *  - `GET` 未配置 ⇒ 默认计划（`dev_docs` + 不限 `mcp`）；`registered` 与注册表一致；
 *  - `GET` 已配置 ⇒ 反映配置（`buildMountPlan` 推导）；
 *  - `PUT` 校验失败（未知 scheme / `mcp` 缺 server）⇒ 400 `INVALID_MOUNTS` 且**未写盘**；
 *  - `PUT` 成功 ⇒ 写盘内容正确（未知字段忽略）+ `warnings` + `requiresRestart`；
 *  - 路由分发命中/未命中。
 *
 * 隔离：以独立临时配置文件替换全局 `ConfigManager`（`setConfigManagerForTest`），
 * 不触碰 `~/.pyapp/config.json`；`afterAll` 还原。**无网络**。
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type http from 'http';
import {
  ConfigManager,
  getConfigManager,
  setConfigManagerForTest,
} from '../../src/config/index.js';
import { vfsMountRegistry } from '../../src/vfs/VfsMountRegistry.js';
import { mcpConnectionManager } from '../../src/services/mcp/MCPConnectionManager.js';
import { createHandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils.js';
import {
  handleGetVfsMounts,
  handlePutVfsMounts,
} from '../../src/infrastructure/http/handlers/vfs-mounts-handlers.js';
import { dispatchVfsMountRoutes } from '../../src/infrastructure/http/handlers/routes/vfs-mounts-routes.js';

/** GET 响应体（契约 §8.2 形状；测试内断言用） */
interface MountView {
  scheme: 'dev_docs' | 'mcp';
  server?: string;
  enabled: boolean;
  registered: boolean;
  readOnly: boolean;
}
interface MountsResponse {
  mounts: MountView[];
  availableSchemes: string[];
  mcpServers: Array<{ name: string; connected: boolean }>;
  requiresRestart: boolean;
}

/** 错误响应体 */
interface ErrorResponse {
  error: { code?: string; message: string };
}

let tempDir = '';
let configPath = '';
let originalManager: ConfigManager;

beforeAll(() => {
  originalManager = getConfigManager();
  tempDir = mkdtempSync(join(tmpdir(), 'vfs-mounts-http-'));
  configPath = join(tempDir, 'config.json');
});

afterAll(() => {
  setConfigManagerForTest(originalManager);
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  // 每个用例以**空白配置文件**启动，避免用例间串扰
  writeFileSync(configPath, '{}', 'utf-8');
  const manager = new ConfigManager(configPath);
  manager.enableConfigs();
  setConfigManagerForTest(manager);
});

function makeReq(
  bodyJson = '',
  method = 'GET',
  url = '/v1/vfs/mounts'
): http.IncomingMessage {
  return {
    url,
    headers: {},
    method,
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data' && bodyJson) cb(Buffer.from(bodyJson));
      if (event === 'end') queueMicrotask(() => cb());
      return this;
    },
  } as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: unknown };
} {
  const out = { status: 0, body: '' };
  const res = {
    headersSent: false,
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
      body: out.body ? (JSON.parse(out.body) as unknown) : undefined,
    }),
  };
}

/** 读取临时配置文件中的 `vfs` 段（写盘断言用） */
function readPersistedVfs(): { mounts?: unknown } | undefined {
  const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    vfs?: { mounts?: unknown };
  };
  return parsed.vfs;
}

describe('GET /v1/vfs/mounts', () => {
  test('未配置 ⇒ 默认计划（dev_docs + 不限 mcp），registered 与注册表一致', async () => {
    const { res, read } = makeRes();
    await handleGetVfsMounts(makeReq(), res);
    const { status, body } = read();
    expect(status).toBe(200);

    const data = body as MountsResponse;
    expect(data.requiresRestart).toBe(true);
    expect(data.availableSchemes).toEqual(['dev_docs', 'mcp']);
    expect(data.mounts.map((m) => m.scheme)).toEqual(['dev_docs', 'mcp']);
    expect(data.mounts[1].server).toBeUndefined();
    expect(data.mounts.every((m) => m.enabled && m.readOnly)).toBe(true);
    // registered 取当前进程注册表
    expect(data.mounts[0].registered).toBe(vfsMountRegistry.has('dev_docs'));
    expect(data.mounts[1].registered).toBe(vfsMountRegistry.has('mcp'));
    // mcpServers 与 mcpConnectionManager.getServers() 同源
    expect(data.mcpServers).toEqual(
      mcpConnectionManager.getServers().map((c) => ({
        name: c.name,
        connected: c.type === 'connected',
      }))
    );
  });

  test('已配置 ⇒ 反映配置（dev_docs 停用 ⇒ 不在计划；mcp 列出限定 server）', async () => {
    const manager = getConfigManager();
    manager.setConfigValue('vfs', {
      mounts: [
        { scheme: 'dev_docs', enabled: false },
        { scheme: 'mcp', server: 'srv-a' },
      ],
    });

    const { res, read } = makeRes();
    await handleGetVfsMounts(makeReq(), res);
    const data = read().body as MountsResponse;

    expect(data.mounts.map((m) => m.scheme)).toEqual(['mcp']);
    expect(data.mounts[0].server).toBe('srv-a');
    expect(data.mounts[0].registered).toBe(vfsMountRegistry.has('mcp'));
  });
});

describe('PUT /v1/vfs/mounts', () => {
  test('未知 scheme ⇒ 400 INVALID_MOUNTS，且未写盘', async () => {
    const before = readFileSync(configPath, 'utf-8');
    const { res, read } = makeRes();
    await handlePutVfsMounts(
      makeReq(
        JSON.stringify({ mounts: [{ scheme: 'file', server: 'x' }] }),
        'PUT'
      ),
      res
    );
    const { status, body } = read();
    expect(status).toBe(400);
    const err = body as ErrorResponse;
    expect(err.error.code).toBe('INVALID_MOUNTS');
    expect(err.error.message).toContain('file');
    // 未写盘
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
    expect(readPersistedVfs()).toBeUndefined();
  });

  test('mcp 缺 server ⇒ 400 INVALID_MOUNTS，且未写盘', async () => {
    const before = readFileSync(configPath, 'utf-8');
    const { res, read } = makeRes();
    await handlePutVfsMounts(
      makeReq(JSON.stringify({ mounts: [{ scheme: 'mcp' }] }), 'PUT'),
      res
    );
    const { status, body } = read();
    expect(status).toBe(400);
    const err = body as ErrorResponse;
    expect(err.error.code).toBe('INVALID_MOUNTS');
    expect(err.error.message).toContain('server');
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
  });

  test('成功 ⇒ 写盘规范化条目（未知字段忽略）+ warnings + requiresRestart', async () => {
    const { res, read } = makeRes();
    await handlePutVfsMounts(
      makeReq(
        JSON.stringify({
          mounts: [
            { scheme: 'dev_docs' },
            { scheme: 'dev_docs', enabled: false },
            { scheme: 'mcp', server: '  srv-a  ' },
            { scheme: 'mcp', server: 'srv-b', enabled: true, extra: 'ignored' },
          ],
        }),
        'PUT'
      ),
      res
    );
    const { status, body } = read();
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      warnings: [],
      requiresRestart: true,
    });

    // 写盘内容：仅保留已知字段，server 去空白，未知字段丢弃
    expect(readPersistedVfs()).toEqual({
      mounts: [
        { scheme: 'dev_docs' },
        { scheme: 'dev_docs', enabled: false },
        { scheme: 'mcp', server: 'srv-a' },
        { scheme: 'mcp', server: 'srv-b', enabled: true },
      ],
    });
    // 与 configManager 运行时读取一致
    expect(getConfigManager().getValue('vfs')).toEqual({
      mounts: [
        { scheme: 'dev_docs' },
        { scheme: 'dev_docs', enabled: false },
        { scheme: 'mcp', server: 'srv-a' },
        { scheme: 'mcp', server: 'srv-b', enabled: true },
      ],
    });
  });

  test('非法 JSON ⇒ 400 INVALID_MOUNTS', async () => {
    const { res, read } = makeRes();
    await handlePutVfsMounts(makeReq('{ not json', 'PUT'), res);
    const { status, body } = read();
    expect(status).toBe(400);
    expect((body as ErrorResponse).error.code).toBe('INVALID_MOUNTS');
  });
});

describe('dispatchVfsMountRoutes', () => {
  test('命中 GET/PUT /v1/vfs/mounts；其他路径不匹配', async () => {
    const ctx = createHandlerCtx();
    const noop = () => {};

    const get = makeRes();
    expect(
      await dispatchVfsMountRoutes(
        makeReq('', 'GET', '/v1/vfs/mounts'),
        get.res,
        '/v1/vfs/mounts',
        noop,
        ctx
      )
    ).toBe(true);

    const put = makeRes();
    expect(
      await dispatchVfsMountRoutes(
        makeReq(JSON.stringify({ mounts: [] }), 'PUT', '/v1/vfs/mounts'),
        put.res,
        '/v1/vfs/mounts',
        noop,
        ctx
      )
    ).toBe(true);

    const miss = makeRes();
    expect(
      await dispatchVfsMountRoutes(
        makeReq('', 'GET', '/v1/other'),
        miss.res,
        '/v1/other',
        noop,
        ctx
      )
    ).toBe(false);
  });
});
