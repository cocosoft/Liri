// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-03b / U-09（2026-10-17）：LRO 工具路径的 workspace 收敛守卫。
 */
import { describe, it, expect } from 'bun:test';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { findWorkspaceEscape } from '../../src/tasks/lro/workspaceGuard.js';

const workspace = join(tmpdir(), 'lro-ws-guard');

describe('findWorkspaceEscape', () => {
  it('工作区内相对路径 ⇒ 放行', () => {
    expect(
      findWorkspaceEscape(workspace, { file_path: 'out/a.txt' })
    ).toBeNull();
    expect(findWorkspaceEscape(workspace, { searchPath: 'src' })).toBeNull();
  });

  it('工作区内绝对路径 ⇒ 放行', () => {
    expect(
      findWorkspaceEscape(workspace, {
        file_path: resolve(workspace, 'out/a.txt'),
      })
    ).toBeNull();
  });

  it('../ 逃逸 ⇒ 拒绝', () => {
    const escape = findWorkspaceEscape(workspace, {
      file_path: '../../etc/passwd',
    });
    expect(escape?.key).toBe('file_path');
  });

  it('工作区外绝对路径 ⇒ 拒绝', () => {
    const outside = resolve(tmpdir(), 'outside-lro', 'a.txt');
    const escape = findWorkspaceEscape(workspace, { path: outside });
    expect(escape?.key).toBe('path');
    expect(escape?.resolved).toBe(outside);
  });

  it('无路径参数 / 空值 ⇒ 不放行也不误拦', () => {
    expect(findWorkspaceEscape(workspace, { command: 'ls' })).toBeNull();
    expect(findWorkspaceEscape(workspace, { file_path: '   ' })).toBeNull();
    expect(findWorkspaceEscape(workspace, { file_path: 42 })).toBeNull();
  });
});
