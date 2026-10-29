/**
 * B1（2026-10-30，issue #35）：会话工作区**多根**判定的纯函数回归。
 *
 * 背景（真机 72h）：`工具路径越界，已拒绝执行（会话工作区严格边界）` 105 次，
 * 全部是模型指向用户真正要分析的目录（`E:\...\PY_APP`），而会话工作区只有
 * `LiriProjects\proj_*` ⇒ 单根 + 越界即死。
 *
 * 本组用例只验证纯函数：
 *  - 任一根之内 ⇒ 通过；
 *  - 全部根外 ⇒ 越界（fail-closed，**不因多根而放宽**）；
 *  - 单根调用 `findWorkspaceEscape` 与旧实现同口径（回归保护）。
 */
import { describe, expect, it } from 'bun:test';

import {
  findWorkspaceEscape,
  findWorkspaceEscapeInRoots,
} from '../../src/utils/toolContract/pathBoundary';

const ROOT_A = 'C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_a';
const ROOT_B = 'E:\\PY\\Documents\\CODES\\PY_APP';

/** 真实路径解析注入：原样返回（本组不涉及符号链接） */
const identity = (p: string): string => p;

describe('findWorkspaceEscapeInRoots：多根判定', () => {
  it('命中第二根 ⇒ 不判越界', () => {
    const escape = findWorkspaceEscapeInRoots(
      [ROOT_A, ROOT_B],
      { path: `${ROOT_B}\\dev_docs\\x.md` },
      { realPath: identity }
    );
    expect(escape).toBeNull();
  });

  it('全部根外 ⇒ 仍判越界（不放宽）', () => {
    const escape = findWorkspaceEscapeInRoots(
      [ROOT_A, ROOT_B],
      { path: 'D:\\secrets\\a.txt' },
      { realPath: identity }
    );
    expect(escape).not.toBeNull();
    expect(escape?.via).toBe('lexical');
    expect(escape?.value).toBe('D:\\secrets\\a.txt');
  });

  it('相对路径按**首根**解析（与单根口径一致）', () => {
    const inside = findWorkspaceEscapeInRoots(
      [ROOT_A, ROOT_B],
      { path: 'src/index.ts' },
      { realPath: identity }
    );
    expect(inside).toBeNull();

    const escape = findWorkspaceEscapeInRoots(
      [ROOT_A, ROOT_B],
      { path: '../outside.txt' },
      { realPath: identity }
    );
    expect(escape?.via).toBe('lexical');
  });

  it('真实路径展开后仍在任一根内 ⇒ 通过；全部根外 ⇒ symlink', () => {
    const escape = findWorkspaceEscapeInRoots(
      [ROOT_A, ROOT_B],
      { path: `${ROOT_A}\\link` },
      { realPath: (p) => (p === `${ROOT_A}\\link` ? 'D:\\elsewhere' : p) }
    );
    expect(escape?.via).toBe('symlink');
  });

  it('空根列表 ⇒ 不判（调用方应回落单根）', () => {
    expect(
      findWorkspaceEscapeInRoots([], { path: 'D:\\x' }, { realPath: identity })
    ).toBeNull();
  });

  it('单根调用与旧实现同口径（回归保护）', () => {
    expect(
      findWorkspaceEscape(ROOT_A, { path: 'src/a.ts' }, { realPath: identity })
    ).toBeNull();
    expect(
      findWorkspaceEscape(ROOT_A, { path: 'D:\\x' }, { realPath: identity })
        ?.via
    ).toBe('lexical');
    expect(
      findWorkspaceEscape(
        ROOT_A,
        { path: `${ROOT_A}\\link` },
        { realPath: (p) => (p === `${ROOT_A}\\link` ? 'D:\\x' : p) }
      )?.via
    ).toBe('symlink');
  });
});
