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
 * 工作空间会话命令
 * 负责 Agent 会话级别的 Git Worktree 进入/退出
 * 同时暴露为 CLI 子命令 (workspace enter/exit) 和 Agent 工具 (EnterWorktreeTool/ExitWorktreeTool)
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('Workspace');

/**
 * 验证 worktree slug 格式
 * 只允许字母、数字、连字符和下划线
 */
function validateSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(slug);
}

/**
 * 获取 Git 根目录
 */
function getGitRoot(cwd: string): string | null {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd,
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * 进入 Worktree
 * 创建并切换到 git worktree，为 Agent 创建隔离的工作区
 * @param slug 工作区标识符
 * @param branch 基于的分支名称（可选）
 * @param cwd 当前工作目录
 */
export async function enterWorktree(
  slug: string,
  branch: string | undefined,
  cwd: string
): Promise<CommandResult> {
  if (!slug || slug.trim().length === 0) {
    return {
      success: false,
      type: 'error',
      error: 'slug 是必需的',
      message: '用法: /workspace enter <slug> [branch]',
    };
  }

  if (!validateSlug(slug)) {
    return {
      success: false,
      type: 'error',
      error: 'slug 格式无效。只允许字母、数字、连字符和下划线。',
      message: 'slug 格式无效。只允许字母、数字、连字符和下划线。',
    };
  }

  const gitRoot = getGitRoot(cwd);
  if (!gitRoot) {
    return {
      success: false,
      type: 'error',
      error: '当前目录不在 Git 仓库中',
      message: '当前目录不在 Git 仓库中。请在 Git 仓库内使用此命令。',
    };
  }

  const worktreePath = join(gitRoot, '..', `${slug}-worktree`);
  if (existsSync(worktreePath)) {
    return {
      success: false,
      type: 'error',
      error: `Worktree "${slug}" 已存在`,
      message: `Worktree "${slug}" 已存在于 ${worktreePath}`,
    };
  }

  const branchName = branch || `worktree/${slug}`;

  try {
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
        stdio: 'pipe',
      });
    } catch {
      execSync(`git branch ${branchName}`, { stdio: 'pipe' });
    }

    execSync(`git worktree add "${worktreePath}" ${branchName}`, {
      stdio: 'pipe',
    });

    logger.info(`Worktree 已创建: ${slug} (${worktreePath})`);

    return {
      success: true,
      type: 'text',
      message: `Worktree "${slug}" 已创建在 ${worktreePath}，基于分支 ${branchName}`,
      data: { slug, worktree_path: worktreePath, branch: branchName },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      type: 'error',
      error: `创建 worktree 失败: ${message}`,
      message: `创建 worktree 失败: ${message}`,
    };
  }
}

/**
 * 退出 Worktree
 * 退出 git worktree 并返回原分支，可选删除 worktree 目录
 * @param slug 工作区标识符
 * @param remove 是否删除 worktree 目录
 * @param cwd 当前工作目录
 */
export async function exitWorktree(
  slug: string,
  remove: boolean,
  cwd: string
): Promise<CommandResult> {
  if (!slug || slug.trim().length === 0) {
    return {
      success: false,
      type: 'error',
      error: 'slug 是必需的',
      message: '用法: /workspace exit <slug> [--remove]',
    };
  }

  try {
    const currentBranch = execSync('git branch --show-current', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    const isInWorktree =
      execSync('git rev-parse --is-inside-work-tree', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim() === 'true';

    if (!isInWorktree) {
      return {
        success: false,
        type: 'error',
        error: '不在 git worktree 中',
        message: '当前不在 git worktree 中。',
      };
    }

    const worktreeList = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const worktreeLines = worktreeList.split('\n');
    let worktreePath = '';
    for (const line of worktreeLines) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.replace('worktree ', '').trim();
        if (worktreePath.includes(slug)) {
          break;
        }
      }
    }

    if (!worktreePath || !existsSync(worktreePath)) {
      return {
        success: false,
        type: 'error',
        error: `Worktree "${slug}" 未找到`,
        message: `找不到 worktree "${slug}"。`,
      };
    }

    const gitRoot = getGitRoot(cwd);
    if (worktreePath === cwd && gitRoot) {
      process.chdir(gitRoot);
    }

    const flag = remove ? '' : '--force';
    execSync(`git worktree remove ${flag} "${worktreePath}"`.trim(), {
      stdio: 'pipe',
    });

    logger.info(`Worktree 已移除: ${slug}`);

    return {
      success: true,
      type: 'text',
      message: `Worktree "${slug}" 已移除。已返回到主分支。`,
      data: { slug, previous_branch: currentBranch },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      type: 'error',
      error: `退出 worktree 失败: ${message}`,
      message: `退出 worktree 失败: ${message}`,
    };
  }
}

export default {
  /**
   * 执行会话子命令
   * @param subcommand 子命令名: enter | exit
   * @param args 命令参数
   * @param context 命令上下文
   */
  async execute(
    subcommand: string,
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const slug = parts[0] || '';

    switch (subcommand) {
      case 'enter': {
        const branch = parts.slice(1).join(' ') || undefined;
        return await enterWorktree(slug, branch, context.cwd || process.cwd());
      }
      case 'exit': {
        const remove = args.includes('--remove');
        return await exitWorktree(slug, remove, context.cwd || process.cwd());
      }
      default:
        return {
          success: false,
          type: 'error',
          error: `未知子命令: ${subcommand}`,
          message: `未知子命令: workspace ${subcommand}`,
        };
    }
  },
};
