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
import { resolveSessionWorkspacePath } from '../../src/chat/services/toolCwdScope.js';

const SANDBOX = 'C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_1';
const EXPLICIT = 'D:\\work\\my-project';

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
