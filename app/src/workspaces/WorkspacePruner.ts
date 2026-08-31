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
 * WorkspacePruner — worktree 残留回收（G5）
 *
 * 清理崩溃/异常退出后遗留的孤儿 worktree：
 *   1. `git worktree prune` —— 清理 git 侧已失效的注册（gitdir 引用丢失）
 *   2. 扫描 `{gitRoot}/../worktrees/`，删除不在 `git worktree list` 中的孤儿目录
 *
 * 安全边界：仅删除 worktrees 目录下的子目录，且该目录未被 git 注册——绝不触碰
 * 主项目或其他用户目录。
 */
import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('workspaces:pruner');

/** 路径归一化（Windows 反斜杠 → 正斜杠），供 git 输出与 join 结果比较 */
function normPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 清理指定 git 仓库的孤儿 worktree
 * @param gitRoot 主仓库根目录
 * @returns 被删除的孤儿 worktree 路径列表
 */
export async function pruneOrphanWorktrees(gitRoot: string): Promise<string[]> {
  const pruned: string[] = [];

  // 1. git 侧清理失效注册（崩溃导致 gitdir 引用丢失的条目）
  try {
    execSync('git worktree prune', { cwd: gitRoot, stdio: 'ignore' });
  } catch {
    // @ignore-catch — prune 失败不阻断目录扫描
  }

  // 2. 获取当前注册的 worktree 路径
  const registered = new Set<string>();
  try {
    const list = execSync('git worktree list --porcelain', {
      cwd: gitRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    for (const line of list.split('\n')) {
      if (line.startsWith('worktree ')) {
        registered.add(normPath(line.slice('worktree '.length).trim()));
      }
    }
  } catch {
    // @ignore-catch — list 失败（非 git 仓库等）则跳过注册检查
  }

  // 3. 扫描 worktrees 目录，删除未注册的孤儿目录
  const worktreesDir = join(gitRoot, '..', 'worktrees');
  if (!existsSync(worktreesDir)) {
    return pruned;
  }

  try {
    const entries = readdirSync(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const p = join(worktreesDir, entry.name);
      if (registered.has(normPath(p))) continue;
      try {
        rmSync(p, { recursive: true, force: true });
        pruned.push(p);
        logger.info('pruneOrphanWorktrees: 已删除孤儿 worktree', { path: p });
      } catch (error) {
        logger.warn('pruneOrphanWorktrees: 孤儿删除失败', {
          path: p,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch {
    // @ignore-catch — 目录不可读则跳过
  }

  return pruned;
}

/**
 * 批量清理多个仓库的孤儿 worktree（启动扫描用）
 * @param gitRoots 待检查的仓库根目录列表
 */
export async function pruneWorkspaceResidue(
  gitRoots: string[]
): Promise<{ pruned: string[]; checkedRepos: number }> {
  const pruned: string[] = [];
  let checkedRepos = 0;
  for (const gitRoot of gitRoots) {
    try {
      const result = await pruneOrphanWorktrees(gitRoot);
      pruned.push(...result);
      checkedRepos++;
    } catch {
      // @ignore-catch — 单仓库清理失败不影响其他
    }
  }
  if (pruned.length > 0) {
    logger.warn('pruneWorkspaceResidue: 发现并清理孤儿 worktree', {
      count: pruned.length,
    });
  }
  return { pruned, checkedRepos };
}
