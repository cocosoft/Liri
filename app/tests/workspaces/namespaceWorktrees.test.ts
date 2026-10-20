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
 * U-02 v2 / P4（2026-10-20）：worktree **命名空间回收**的纯解析回归。
 *
 * 覆盖 `selectNamespaceWorktrees()`：只认 `{gitRoot}/../worktrees/` 下**一级子目录**、
 * 且目录名以 `${prefix}-` 开头者 ⇒ 不会误伤主工作树、Bridge 的 `bridge-*` 或深层路径。
 */
import { describe, expect, it } from 'bun:test';

import { selectNamespaceWorktrees } from '../../src/workspaces/WorkspacePruner';

const WORKTREES_DIR = '/repo/worktrees';

function porcelain(blocks: string[][]): string {
  return blocks.map((lines) => lines.join('\n')).join('\n\n');
}

describe('selectNamespaceWorktrees', () => {
  const sample = porcelain([
    ['worktree /repo', 'HEAD aaaa', 'branch refs/heads/main'],
    [
      'worktree /repo/worktrees/alwayson-p1-1',
      'HEAD bbbb',
      'branch refs/heads/alwayson/p1-1',
    ],
    [
      'worktree /repo/worktrees/bridge-s1',
      'HEAD cccc',
      'branch refs/heads/bridge/s1',
    ],
    ['worktree /repo/worktrees/alwayson-detached', 'HEAD dddd', 'detached'],
  ]);

  it('按前缀只挑本命名空间（主工作树 / Bridge 的 bridge-* 不命中）', () => {
    const selected = selectNamespaceWorktrees(
      sample,
      WORKTREES_DIR,
      'alwayson'
    );
    expect(selected.map((w) => w.path)).toEqual([
      '/repo/worktrees/alwayson-p1-1',
      '/repo/worktrees/alwayson-detached',
    ]);
    expect(selected[0]!.branch).toBe('alwayson/p1-1');
    // detached 条目没有 branch 行 ⇒ 缺省（调用方据此跳过分支删除）
    expect(selected[1]!.branch).toBeUndefined();
  });

  it('换前缀 ⇒ 只挑该前缀（互不误伤）', () => {
    const selected = selectNamespaceWorktrees(sample, WORKTREES_DIR, 'bridge');
    expect(selected.map((w) => w.path)).toEqual(['/repo/worktrees/bridge-s1']);
  });

  it('前缀相似但缺连字符 ⇒ 不命中（alwaysonx-* 不属于 alwayson）', () => {
    const text = porcelain([
      [
        'worktree /repo/worktrees/alwaysonx-1',
        'HEAD eeee',
        'branch refs/heads/alwaysonx/1',
      ],
    ]);
    expect(selectNamespaceWorktrees(text, WORKTREES_DIR, 'alwayson')).toEqual(
      []
    );
  });

  it('深层路径（worktrees 下二级目录）⇒ 不命中', () => {
    const text = porcelain([
      [
        'worktree /repo/worktrees/alwayson-1/nested',
        'HEAD ffff',
        'branch refs/heads/alwayson/nested',
      ],
    ]);
    expect(selectNamespaceWorktrees(text, WORKTREES_DIR, 'alwayson')).toEqual(
      []
    );
  });

  it('Windows 反斜杠输出与目录同样归一化后比较', () => {
    const text = porcelain([
      [
        'worktree C:\\repo\\worktrees\\alwayson-1',
        'HEAD abab',
        'branch refs/heads/alwayson/1',
      ],
    ]);
    const selected = selectNamespaceWorktrees(
      text,
      'C:\\repo\\worktrees',
      'alwayson'
    );
    expect(selected).toEqual([
      { path: 'C:/repo/worktrees/alwayson-1', branch: 'alwayson/1' },
    ]);
  });

  it('空输出 ⇒ 空结果（不猜测）', () => {
    expect(selectNamespaceWorktrees('', WORKTREES_DIR, 'alwayson')).toEqual([]);
    expect(selectNamespaceWorktrees('\n\n', WORKTREES_DIR, 'alwayson')).toEqual(
      []
    );
  });
});
