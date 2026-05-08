/**
 * 退出Worktree工具
 * 用于退出worktree并返回原分支
 * 参考CC源码 cc_code/backend/tools/ExitWorktreeTool/ExitWorktreeTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

/**
 * 退出Worktree输入
 */
export interface ExitWorktreeInput {
  /**
   * 要退出的worktree标识符
   */
  slug: string;

  /**
   * 是否删除worktree目录
   */
  remove?: boolean;
}

/**
 * 退出Worktree输出
 */
export interface ExitWorktreeOutput {
  success: boolean;
  message: string;
  previous_branch?: string;
}

/**
 * 退出Worktree工具
 */
export class ExitWorktreeTool extends BaseTool<
  ExitWorktreeInput,
  ExitWorktreeOutput
> {
  /**
   * 工具名称
   */
  name = 'ExitWorktree';

  /**
   * 工具描述
   */
  description = '退出git worktree并返回原分支，可选删除worktree目录。';

  /**
   * 工具参数
   */
  params = [
    {
      name: 'slug',
      type: 'string',
      description: '要退出的worktree标识符',
      required: true,
    },
    {
      name: 'remove',
      type: 'boolean',
      description: '是否删除worktree目录',
      required: false,
      default: false,
    },
  ];

  override searchHint = 'exit git worktree and return to main branch';

  override maxResultSizeChars = 100_000;

  override shouldDefer = true;

  override isEnabled(): boolean {
    // 检查是否在git仓库中
    try {
      execSync('git rev-parse --git-dir', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  override isDestructive(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 执行退出Worktree
   */
  async execute(
    input: ExitWorktreeInput,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<ExitWorktreeOutput>> {
    const { slug, remove = false } = input;

    // 验证输入
    if (!slug || slug.trim().length === 0) {
      return createToolResult(
        {
          success: false,
          message: 'slug is required',
        },
        {
          newMessages: [
            {
              role: 'system',
              content: '错误: slug 是必需的',
            },
          ],
        }
      );
    }

    try {
      // 获取当前分支
      const currentBranch = execSync('git branch --show-current', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      // 获取git根目录
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      // 获取主仓库路径
      const mainWorktreePath = gitRoot;

      // 检查是否在worktree中
      const isInWorktree =
        execSync('git rev-parse --is-inside-work-tree', {
          encoding: 'utf8',
          stdio: 'pipe',
        }).trim() === 'true';

      if (!isInWorktree) {
        return createToolResult(
          {
            success: false,
            message: 'Not in a git worktree',
          },
          {
            newMessages: [
              {
                role: 'system',
                content: '错误: 不在git worktree中',
              },
            ],
          }
        );
      }

      // 获取worktree列表
      const worktreeList = execSync('git worktree list --porcelain', {
        encoding: 'utf8',
        stdio: 'pipe',
      });

      // 查找匹配的worktree
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
        return createToolResult(
          {
            success: false,
            message: `Worktree "${slug}" not found`,
          },
          {
            newMessages: [
              {
                role: 'system',
                content: `找不到worktree "${slug}"`,
              },
            ],
          }
        );
      }

      // 如果当前在worktree中，先返回主仓库
      if (worktreePath === process.cwd()) {
        process.chdir(mainWorktreePath);
      }

      // 删除worktree
      if (remove) {
        execSync(`git worktree remove "${worktreePath}"`, {
          stdio: 'pipe',
        });
      } else {
        execSync(`git worktree remove --force "${worktreePath}"`, {
          stdio: 'pipe',
        });
      }

      return createToolResult(
        {
          success: true,
          message: `Worktree "${slug}" removed. Returned to main branch.`,
          previous_branch: currentBranch,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `Worktree "${slug}" 已移除。返回到主分支。`,
            },
          ],
        }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return createToolResult(
        {
          success: false,
          message: `Failed to exit worktree: ${errorMessage}`,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `退出worktree失败: ${errorMessage}`,
            },
          ],
        }
      );
    }
  }

  override userFacingName(): string {
    return '退出Worktree';
  }

  override getActivityDescription(input?: Partial<ExitWorktreeInput>): string | null {
    if (input?.slug) {
      return `退出worktree ${input.slug}`;
    }
    return '退出worktree';
  }
}

/**
 * 创建退出Worktree工具实例
 */
export function createExitWorktreeTool(): ExitWorktreeTool {
  return new ExitWorktreeTool();
}
