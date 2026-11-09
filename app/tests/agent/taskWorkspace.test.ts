/**
 * 长程任务 cwd 对齐会话工作区（2026-11-09 真机 `pdca_mw8txe5r`）。
 *
 * 背景：任务恒定跑在 `~/.pyapp/workspaces/<taskId>`（空目录），会话里用户选定的
 * 工作区（含既有文件）完全不可见 ⇒ `file_read hello.txt` 不存在，步骤重试 3 轮后空转。
 * 现口径（方案 B）：解析器给出可用目录 ⇒ 就用它；未注册/未知会话 ⇒ 保留隔离目录。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isUsableDirectory } from '@openliri/infra/utils/toolContract/workspaceRoots';
import {
  alignTaskWorkspace,
  createAgentIsolation,
  setTaskWorkspaceResolver,
} from '../../src/agent/index';

describe('alignTaskWorkspace：cwd = 会话工作区（缺省保留隔离目录）', () => {
  let root: string;
  let project: string;
  let isolation: ReturnType<typeof createAgentIsolation>;
  const taskId = `pdca_cwd_${Date.now()}`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'liri-cwd-'));
    project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    setTaskWorkspaceResolver((sid) => (sid === 's1' ? project : undefined));
    isolation = createAgentIsolation(taskId);
  });

  afterEach(() => {
    setTaskWorkspaceResolver(undefined);
    rmSync(root, { recursive: true, force: true });
    rmSync(isolation.workspace, { recursive: true, force: true });
  });

  it('会话有工作区 ⇒ 切到会话目录（既有文件对模型可见）', () => {
    const previous = isolation.workspace;
    expect(alignTaskWorkspace(isolation, taskId, 's1')).toBe(true);
    expect(isolation.workspace).toBe(project);
    expect(isolation.workspace).not.toBe(previous);
  });

  it('裸会话（无 sessionId / 未知会话）⇒ 保留隔离目录', () => {
    expect(alignTaskWorkspace(isolation, taskId, undefined)).toBe(false);
    expect(alignTaskWorkspace(isolation, taskId, 'unknown')).toBe(false);
  });

  it('未注册解析器 ⇒ 保留隔离目录（零行为变更）', () => {
    setTaskWorkspaceResolver(undefined);
    expect(alignTaskWorkspace(isolation, taskId, 's1')).toBe(false);
  });

  it('解析出的目录不存在 ⇒ 不切换（绝不落到不可访问的 cwd）', () => {
    const missing = join(root, 'missing');
    setTaskWorkspaceResolver(() => missing);
    expect(isUsableDirectory(missing)).toBe(false);
    expect(alignTaskWorkspace(isolation, taskId, 's1')).toBe(false);
    expect(isolation.workspace).not.toBe(missing);
  });
});
