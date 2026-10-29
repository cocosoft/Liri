/**
 * GET /v1/projects/:id/files —— 沙箱目录缺失时的读侧自愈（F-23，2026-10-29）
 *
 * 背景：`ProjectStore.create()` 的 `delaySandbox: true` 只把「首次使用再 mkdir」接在
 * **写**路径（首次写文件 / 上传 `00_input/`）。经 `migrateWorktrees` 建的项目如果旧
 * worktree 路径已不存在，就**永远**没有目录（真机 3 个）⇒ `project-context.md` 的
 * 「文件夹」指向不存在路径、提示词里的项目文件列表恒为空。
 *
 * 本文件锁住三件事：
 *  1. 目录缺失时**补建**（读即自愈）；
 *  2. 响应仍是 F-18 的同形对象 `{files, dirs, sandboxPath}`（不是数组）；
 *  3. 补建失败（如父路径是文件 ⇒ ENOTDIR）**不得**让读接口 500。
 *
 * 说明：与 `checkpoint-handlers.test.ts` 同法 —— 不用进程级 `mock.module`，
 * 用 `spyOn(模块命名空间)` + 动态导入被测 handler。
 */

import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import type http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 当前用例返回的项目（`getProjectStore().get()`） */
let projectStub: { id: string; sandboxPath: string } | null = null;

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  getWorkspaceOpsPort: async () => ({
    getProjectStore: async () => ({ get: () => projectStub }),
  }),
} as never);

const { handleListProjectFiles } =
  await import('../../src/infrastructure/http/handlers/project-artifact-handlers');

/** 每个用例独占的临时根目录（用例后整体删除） */
let tmpRoots: string[] = [];

function makeTmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-f23-'));
  tmpRoots.push(root);
  return root;
}

function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
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
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

const req = {
  url: '/v1/projects/proj_x/files',
  headers: {},
  method: 'GET',
} as unknown as http.IncomingMessage;

afterEach(() => {
  for (const root of tmpRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tmpRoots = [];
  projectStub = null;
});

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

describe('handleListProjectFiles：沙箱目录缺失时读侧自愈（F-23）', () => {
  test('目录不存在 ⇒ 补建，并返回同形空对象', async () => {
    const sandboxPath = join(makeTmpRoot(), 'sandbox');
    expect(existsSync(sandboxPath)).toBe(false);
    projectStub = { id: 'proj_x', sandboxPath };

    const { res, read } = makeRes();
    await handleListProjectFiles(req, res, 'proj_x');

    expect(existsSync(sandboxPath)).toBe(true);
    expect(read()).toEqual({
      status: 200,
      body: { files: [], dirs: [], sandboxPath },
    });
  });

  test('目录已存在 ⇒ 不重建、正常列出文件', async () => {
    const sandboxPath = join(makeTmpRoot(), 'sandbox');
    mkdirSync(sandboxPath, { recursive: true });
    writeFileSync(join(sandboxPath, 'a.txt'), 'hello');
    projectStub = { id: 'proj_x', sandboxPath };

    const { res, read } = makeRes();
    await handleListProjectFiles(req, res, 'proj_x');

    const { status, body } = read();
    expect(status).toBe(200);
    expect(Array.isArray(body.files)).toBe(true);
    expect((body.files as Array<{ name: string }>).map((f) => f.name)).toEqual([
      'a.txt',
    ]);
  });

  test('补建失败（父路径是文件 ⇒ ENOTDIR）⇒ 仍 200 + 同形空对象，不 500', async () => {
    const root = makeTmpRoot();
    const blocker = join(root, 'blocker');
    writeFileSync(blocker, 'not a dir');
    const sandboxPath = join(blocker, 'sub');
    projectStub = { id: 'proj_x', sandboxPath };

    const { res, read } = makeRes();
    await handleListProjectFiles(req, res, 'proj_x');

    expect(existsSync(sandboxPath)).toBe(false);
    expect(read()).toEqual({
      status: 200,
      body: { files: [], dirs: [], sandboxPath },
    });
  });

  test('项目不存在 ⇒ 404（自愈不放宽存在性校验）', async () => {
    projectStub = null;

    const { res, read } = makeRes();
    await handleListProjectFiles(req, res, 'proj_missing');

    expect(read()).toEqual({
      status: 404,
      body: { error: '项目或文件夹不存在' },
    });
  });
});
