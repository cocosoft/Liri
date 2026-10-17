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
    expect(escape?.via).toBe('lexical');
  });

  it('工作区外绝对路径 ⇒ 拒绝', () => {
    const outside = resolve(tmpdir(), 'outside-lro', 'a.txt');
    const escape = findWorkspaceEscape(workspace, { path: outside });
    expect(escape?.key).toBe('path');
    expect(escape?.resolved).toBe(outside);
    expect(escape?.via).toBe('lexical');
  });

  // U-24：符号链接旁路（纯词法检查看不见链接目标）。
  describe('符号链接 / 真实路径（U-24）', () => {
    it('字面在 workspace 内、真实路径越界 ⇒ 拒绝（via=symlink）', () => {
      const escape = findWorkspaceEscape(
        workspace,
        { file_path: 'link/secret.env' },
        {
          realPath: (p) => {
            if (p === workspace) return resolve('/real/ws');
            if (p.endsWith('secret.env')) return resolve('/outside/secret.env');
            return p;
          },
        }
      );
      expect(escape?.key).toBe('file_path');
      expect(escape?.via).toBe('symlink');
    });

    it('workspace 自身为符号链接，子路径仍在其真实根内 ⇒ 放行（不误拦）', () => {
      const realRoot = resolve('/real/ws');
      const escape = findWorkspaceEscape(
        workspace,
        { file_path: 'out/a.txt' },
        {
          realPath: (p) =>
            p.startsWith(workspace) ? p.replace(workspace, realRoot) : p,
        }
      );
      expect(escape).toBeNull();
    });
  });

  it('无路径参数 / 空值 ⇒ 不放行也不误拦', () => {
    expect(findWorkspaceEscape(workspace, { command: 'ls' })).toBeNull();
    expect(findWorkspaceEscape(workspace, { file_path: '   ' })).toBeNull();
    expect(findWorkspaceEscape(workspace, { file_path: 42 })).toBeNull();
  });
});
