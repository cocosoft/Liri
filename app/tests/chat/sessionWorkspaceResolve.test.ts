// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-06（2026-10-26 真机实测）／D4 后半：**会话工作区解析**守卫。
 *
 * 实测缺口：项目会话 metadata 只有 `projectId`、没有 `workspacePath` ⇒ 工具 cwd 回落到
 * `resolveProjectRoot()`（代码仓根）。本用例锁定的不变量：
 *   1. 绝对 `workspacePath` 优先（客户端/用户显式指定，历史语义不变）；
 *   2. 相对 `workspacePath`（存量"项目名"脏值）**不得**当 cwd ⇒ 继续按 projectId 解析；
 *   3. `projectId` ⇒ 项目 `sandboxPath`（用户项目目录）；解析失败/非绝对 ⇒ undefined（回落项目根）；
 *   4. 无 projectId 且无 workspacePath ⇒ undefined（无项目会话保持旧行为）。
 */
import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import {
  resolveSessionWorkspacePath,
  resolveRequestWorkspaceUpdate,
} from '../../src/chat/services/toolCwdScope.js';

// `isAbsolute()` 是**平台相关**的：`D:\…` 在 POSIX 上不是绝对路径。
// 本文件断言的是"绝对/相对"语义，因此夹具必须按当前平台构造，
// 否则 Windows 绿的用例会在 ubuntu/macOS 上全红（CI 实测）。
const IS_WIN = process.platform === 'win32';
const SANDBOX = IS_WIN
  ? 'C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_1'
  : join('/home/csdnc/Documents/LiriProjects', 'proj_1');
const EXPLICIT = IS_WIN ? 'D:\\work\\my-project' : '/work/my-project';

function resolveWith(
  metadata: Record<string, unknown> | undefined,
  sandbox: Record<string, string | undefined> = { proj_1: SANDBOX }
): string | undefined {
  return resolveSessionWorkspacePath({
    metadata,
    getProjectSandboxPath: (id) => sandbox[id],
  });
}

describe('LRO-06：会话工作区解析优先级', () => {
  it('绝对 workspacePath 优先（即便有 projectId）', () => {
    expect(resolveWith({ workspacePath: EXPLICIT, projectId: 'proj_1' })).toBe(
      EXPLICIT
    );
  });

  it('无 workspacePath ⇒ 由 projectId 解析项目 sandboxPath', () => {
    expect(resolveWith({ projectId: 'proj_1' })).toBe(SANDBOX);
  });

  it('相对 workspacePath（存量项目名脏值）不当作 cwd ⇒ 仍按 projectId 解析', () => {
    expect(
      resolveWith({ workspacePath: 'super-mario-liri', projectId: 'proj_1' })
    ).toBe(SANDBOX);
  });

  it('projectId 未知 / sandboxPath 缺失 / 非绝对 ⇒ undefined（调用方回落项目根）', () => {
    expect(resolveWith({ projectId: 'proj_missing' })).toBeUndefined();
    expect(
      resolveWith({ projectId: 'proj_1' }, { proj_1: '' })
    ).toBeUndefined();
    expect(
      resolveWith({ projectId: 'proj_1' }, { proj_1: 'relative/sandbox' })
    ).toBeUndefined();
  });

  it('无 projectId 且无 workspacePath ⇒ undefined（无项目会话保持旧行为）', () => {
    expect(resolveWith({})).toBeUndefined();
    expect(resolveWith(undefined)).toBeUndefined();
  });
});

/**
 * BUG-B（2026-10-27，真机长程任务）：请求体 `workspace_path` 原本只进请求 metadata、
 * 不进会话 metadata ⇒ 工具 cwd 回落代码仓根（实测把产物写进仓库）。
 * 本用例锁定"请求值 ⇒ 会话 workspacePath"的落盘口径。
 */
describe('BUG-B：请求体 workspace_path 落到会话 metadata', () => {
  it('请求值绝对路径 + 会话无工作区 ⇒ 采用请求值', () => {
    expect(
      resolveRequestWorkspaceUpdate({
        requestWorkspacePath: EXPLICIT,
        sessionWorkspacePath: undefined,
      })
    ).toBe(EXPLICIT);
  });

  it('请求值与会话一致 ⇒ undefined（不重复写库）', () => {
    expect(
      resolveRequestWorkspaceUpdate({
        requestWorkspacePath: EXPLICIT,
        sessionWorkspacePath: EXPLICIT,
      })
    ).toBeUndefined();
  });

  it('请求值不同 ⇒ 以请求值为准（客户端当前显式选择）', () => {
    expect(
      resolveRequestWorkspaceUpdate({
        requestWorkspacePath: EXPLICIT,
        sessionWorkspacePath: SANDBOX,
      })
    ).toBe(EXPLICIT);
  });

  it('负向对照：相对路径 / 空值 / 非字符串 ⇒ 不更新', () => {
    for (const bad of ['super-mario-liri', '', 42, null, undefined]) {
      expect(
        resolveRequestWorkspaceUpdate({
          requestWorkspacePath: bad,
          sessionWorkspacePath: undefined,
        })
      ).toBeUndefined();
    }
  });
});
