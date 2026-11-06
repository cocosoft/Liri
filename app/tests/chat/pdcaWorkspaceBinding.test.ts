// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P2-1（2026-11-06）回归锁：自动建项目时复用会话**显式工作区**作为项目沙箱。
//
// 真机 `session_mw458fpp3ea32a050e`：会话工作区 `E:\…\PY_APP`（产物 `output/tetris`），
// 自动建项目却用默认 `~/Documents/LiriProjects/<id>` ⇒ 空沙箱 + 工作区被切走，
// 模型下一轮再也找不到本轮产物。

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveExistingSessionWorkspace,
  resolveProjectSandboxPath,
} from '../../src/chat/manager/pdcaLaunch';
import type { ChatSession } from '@modules/session/types/session.js';

function sessionWith(workspacePath: unknown): ChatSession {
  return { id: 's1', metadata: { workspacePath } } as unknown as ChatSession;
}

describe('P2-1：项目沙箱复用会话工作区', () => {
  it('显式工作区是真实目录 ⇒ 原样返回（项目沙箱 = 产物所在目录）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2-1-ws-'));
    try {
      expect(resolveExistingSessionWorkspace(sessionWith(dir))).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('负向：目录不存在 / 是文件 / 相对路径 / 缺省 ⇒ undefined（回退默认沙箱）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2-1-ws-'));
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x');
    try {
      expect(
        resolveExistingSessionWorkspace(sessionWith(join(dir, 'missing')))
      ).toBeUndefined();
      expect(
        resolveExistingSessionWorkspace(sessionWith(file))
      ).toBeUndefined();
      expect(
        resolveExistingSessionWorkspace(sessionWith('relative/workspace'))
      ).toBeUndefined();
      expect(resolveExistingSessionWorkspace(sessionWith(undefined))).toBe(
        undefined
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * N-4（2026-11-06）：**裸会话**（无显式工作区）的项目沙箱必须与会话工具的实际 cwd 一致。
 *
 * 真机 `session_mw4vwtmp38957bec2f`：自动建项目 `sandboxPath=~/Documents/LiriProjects/<id>`
 * （`delaySandbox` ⇒ 目录从未创建），而产物写在工具 cwd（`output/mario`）⇒ 项目空指向。
 */
describe('N-4：项目沙箱回落工具实际 cwd', () => {
  it('有显式工作区 ⇒ 用它，且不调用 cwd 解析', () => {
    const dir = mkdtempSync(join(tmpdir(), 'n4-ws-'));
    let called = false;
    try {
      const sandbox = resolveProjectSandboxPath(sessionWith(dir), () => {
        called = true;
        return 'C:\\fallback';
      });
      expect(sandbox).toEqual({
        sandboxPath: dir,
        source: 'session-workspace',
      });
      expect(called).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('裸会话 / 工作区失效 ⇒ 回落工具 cwd（同源解析器）', () => {
    expect(
      resolveProjectSandboxPath(sessionWith(undefined), () => 'C:\\tool-cwd')
    ).toEqual({ sandboxPath: 'C:\\tool-cwd', source: 'tool-cwd' });
    expect(
      resolveProjectSandboxPath(
        sessionWith(join(tmpdir(), 'n4-missing-dir')),
        () => 'C:\\tool-cwd'
      )
    ).toEqual({ sandboxPath: 'C:\\tool-cwd', source: 'tool-cwd' });
  });
});
