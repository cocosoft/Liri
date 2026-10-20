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
import { exec as nodeExec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('workspaces:pruner');

/**
 * 外部命令执行（**异步**，阻塞源收敛 2026-10-04，台账 V-2）。
 *
 * 原 `execSync` 会让 `git worktree prune` / `list` 同步阻塞事件循环（`list` 在大仓可达秒级）。
 * 本函数本就是 async ⇒ 改 `promisify(exec)`，零签名变化。
 */
const execAsync = promisify(nodeExec);

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
    await execAsync('git worktree prune', { cwd: gitRoot });
  } catch {
    // @ignore-catch — prune 失败不阻断目录扫描
  }

  // 2. 获取当前注册的 worktree 路径
  const registered = new Set<string>();
  try {
    const { stdout: list } = await execAsync('git worktree list --porcelain', {
      cwd: gitRoot,
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

/** 某个命名空间下**已注册**的 worktree（纯解析产物） */
export interface NamespaceWorktree {
  path: string;
  /** 短分支名（`refs/heads/` 已剥离）；detached ⇒ 缺省 */
  branch?: string;
}

/**
 * 从 `git worktree list --porcelain` 输出中挑选**指定命名空间**的 worktree（纯函数）。
 *
 * 命名空间 = `{gitRoot}/../worktrees/` 下、**一级子目录**名以 `${prefix}-` 开头者。
 * 只认一级子目录 ⇒ 不可能命中主工作树或 worktrees 目录之外的路径。
 *
 * 2026-10-20（U-02 v2 / P4）：AlwaysOn 崩溃/异常退出会留下**已注册**的
 * `alwayson-*` worktree —— `pruneOrphanWorktrees()` 只删"未注册"目录，管不到这类
 * ⇒ 需要按前缀单独回收。
 */
export function selectNamespaceWorktrees(
  porcelain: string,
  worktreesDir: string,
  prefix: string
): NamespaceWorktree[] {
  const dir = normPath(worktreesDir).replace(/\/+$/, '');
  const namePrefix = `${prefix}-`;
  const selected: NamespaceWorktree[] = [];

  for (const block of porcelain.split(/\r?\n\s*\r?\n/)) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        path = normPath(line.slice('worktree '.length).trim());
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length).trim();
        branch = ref.startsWith('refs/heads/')
          ? ref.slice('refs/heads/'.length)
          : ref;
      }
    }
    if (!path || !path.startsWith(`${dir}/`)) continue;
    const base = path.slice(dir.length + 1);
    if (base.includes('/')) continue;
    if (!base.startsWith(namePrefix)) continue;
    selected.push(branch ? { path, branch } : { path });
  }
  return selected;
}

/**
 * 回收指定命名空间的**已注册** worktree（崩溃/异常退出残留），并删除其分支。
 *
 * @param projectRoot 项目根（内部解析 git root；非 git 仓库 ⇒ 空结果）
 * @param prefix 命名前缀（与 `WorkspaceGit` 的 `namePrefix` 一致，如 `alwayson`）
 * @returns 被移除的 worktree 路径
 */
export async function pruneNamespaceWorktrees(
  projectRoot: string,
  prefix: string
): Promise<string[]> {
  const removed: string[] = [];

  let gitRoot: string;
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: projectRoot,
    });
    gitRoot = stdout.trim();
    if (!gitRoot) return removed;
  } catch {
    // 非 git 仓库 ⇒ 不存在命名空间 worktree（调用方按"跳过本轮"处理）
    return removed;
  }

  let porcelain: string;
  try {
    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: gitRoot,
    });
    porcelain = stdout;
  } catch {
    // @ignore-catch — list 失败则无法判定，保持原状（不误删）
    return removed;
  }

  const targets = selectNamespaceWorktrees(
    porcelain,
    join(gitRoot, '..', 'worktrees'),
    prefix
  );
  for (const target of targets) {
    try {
      await execAsync(`git worktree remove --force "${target.path}"`, {
        cwd: gitRoot,
      });
      removed.push(target.path);
    } catch (error) {
      logger.warn('pruneNamespaceWorktrees: 移除残留 worktree 失败', {
        prefix,
        path: target.path,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!target.branch) continue;
    try {
      await execAsync(`git branch -D "${target.branch}"`, { cwd: gitRoot });
    } catch {
      // @ignore-catch — 分支删除失败不阻断（worktree 已移除）
    }
  }

  if (removed.length > 0) {
    logger.warn('pruneNamespaceWorktrees: 已回收残留隔离区', {
      prefix,
      count: removed.length,
    });
  }
  return removed;
}
