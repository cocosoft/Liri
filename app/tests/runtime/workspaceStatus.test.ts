/**
 * P0-1（2026-11-05）：会话工作区状态（`workspaceStatus`）——**发消息前**就暴露"工作区已失效"。
 *
 * 真机背景：worktree 被清理后会话仍钉在旧根，旧行为是首轮工具调用连续失败
 *（「路径越界 / ENOENT」）才暴露；用户只感到"任务莫名停摆"。
 *
 * 本用例锁：状态判定的四档（unbound / ok / partial / invalid）、根列表合并口径，
 * 以及 `resolveWorkspaceStatus()` 只从 metadata 派生（不落库、不改会话状态）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import {
  computeWorkspaceStatus,
  isUsableDirectory,
  mergeWorkspaceRoots,
} from '@openliri/infra/utils/toolContract/workspaceRoots';
import { resolveWorkspaceStatus } from '../../src/runtime/api/sessionAgentOps.js';

const base = join(tmpdir(), `p01-workspace-${randomUUID()}`);
const liveRoot = join(base, 'live');
const deadRoot = join(base, 'dead');
const aFile = join(base, 'not-a-dir.txt');

beforeAll(() => {
  mkdirSync(liveRoot, { recursive: true });
  writeFileSync(aFile, 'x', 'utf-8');
});

afterAll(() => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe('P0-1 computeWorkspaceStatus（纯判定）', () => {
  it('无根 ⇒ unbound（未绑定工作区不是错误）', () => {
    expect(computeWorkspaceStatus([], () => true)).toEqual({
      state: 'unbound',
      roots: [],
      missingRoots: [],
    });
  });

  it('全部可用 ⇒ ok；全部失效 ⇒ invalid；部分失效 ⇒ partial', () => {
    expect(computeWorkspaceStatus(['/a', '/b'], () => true).state).toBe('ok');
    expect(computeWorkspaceStatus(['/a', '/b'], () => false).state).toBe(
      'invalid'
    );
    const partial = computeWorkspaceStatus(['/a', '/b'], (p) => p === '/a');
    expect(partial.state).toBe('partial');
    expect(partial.missingRoots).toEqual(['/b']);
  });
});

describe('P0-1 isUsableDirectory（与工具面同一判据）', () => {
  it('存在的目录 ⇒ true；不存在的目录 / 普通文件 ⇒ false', () => {
    expect(isUsableDirectory(liveRoot)).toBe(true);
    expect(isUsableDirectory(deadRoot)).toBe(false);
    expect(isUsableDirectory(aFile)).toBe(false);
  });
});

describe('P0-1 resolveWorkspaceStatus（详情接口读时派生）', () => {
  it('metadata.workspacePath 指向已删目录 ⇒ invalid（真机 worktree 场景）', () => {
    const status = resolveWorkspaceStatus({ workspacePath: deadRoot });
    expect(status.state).toBe('invalid');
    expect(status.missingRoots).toEqual([deadRoot]);
  });

  it('主根可用 + 追加根失效 ⇒ partial（多根场景）', () => {
    const status = resolveWorkspaceStatus({
      workspacePath: liveRoot,
      workspaceRoots: [deadRoot],
    });
    expect(status.state).toBe('partial');
    expect(status.roots).toEqual([liveRoot, deadRoot]);
    expect(status.missingRoots).toEqual([deadRoot]);
  });

  it('无 workspacePath / 仅 projectId（需查项目库）⇒ unbound，不臆造状态', () => {
    expect(resolveWorkspaceStatus(undefined).state).toBe('unbound');
    expect(resolveWorkspaceStatus({}).state).toBe('unbound');
    expect(resolveWorkspaceStatus({ projectId: 'proj_x' }).state).toBe(
      'unbound'
    );
  });

  it('相对值 workspacePath（存量脏数据）⇒ unbound，不误报失效', () => {
    // 真机：`session_mvzzaaux97c95991e0` 的 workspacePath 是项目名 `proj_…`（非路径）。
    // 工具面 `resolveSessionWorkspacePath` 只认绝对路径 ⇒ 会话面必须同口径，
    // 否则会把"工具其实会忽略它"的会话误报成 invalid。
    expect(resolveWorkspaceStatus({ workspacePath: 'proj_17929' }).state).toBe(
      'unbound'
    );
  });

  it('根列表与工具面同口径（去尾斜杠 + 大小写归一后去重）', () => {
    const roots = mergeWorkspaceRoots(`${liveRoot}\\`, [`${liveRoot}/`]);
    expect(roots).toEqual([`${liveRoot}\\`]);
  });
});
