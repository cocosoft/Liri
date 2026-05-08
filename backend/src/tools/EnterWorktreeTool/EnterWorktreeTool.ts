/**
 * 进入Worktree工具
 * 用于创建并切换到git worktree，为Agent创建隔离的工作区
 * 参考CC源码 cc_code/backend/tools/EnterWorktreeTool/EnterWorktreeTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * 进入Worktree输入
 */
export interface EnterWorktreeInput {
  /**
   * Worktree标识符（用于创建worktree目录）
   */
  slug: string;

  /**
   * 基于的分支名称（可选，默认创建新分支）
   */
  branch?: string;
}

/**
 * 进入Worktree输出
 */
export interface EnterWorktreeOutput {
  success: boolean;
  message: string;
  worktree_path?: string;
  branch?: string;
}

/**
 * 进入Worktree工具
 */
export class EnterWorktreeTool extends BaseTool<
  EnterWorktreeInput,
  EnterWorktreeOutput
> {
  /**
   * 工具名称
   */
  name = 'EnterWorktree';

  /**
   * 工具描述
   */
  description =
    '创建并切换到git worktree，为Agent创建隔离的工作区，避免污染主工作区。';

  /**
   * 工具参数
   */
  params = [
    {
      name: 'slug',
      type: 'string',
      description: 'Worktree标识符（用于创建worktree目录）',
      required: true,
    },
    {
      name: 'branch',
      type: 'string',
      description: '基于的分支名称（可选，默认创建新分支）',
      required: false,
    },
  ];

  override searchHint = 'create git worktree for isolated workspace';

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
    return false;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 验证worktree标识符
   */
  private validateWorktreeSlug(slug: string): boolean {
    // 只允许字母、数字、连字符和下划线
    return /^[a-zA-Z0-9_-]+$/.test(slug);
  }

  /**
   * 执行进入Worktree
   */
  async execute(
    input: EnterWorktreeInput,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<EnterWorktreeOutput>> {
    const { slug, branch } = input;

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

    // 验证slug格式
    if (!this.validateWorktreeSlug(slug)) {
      return createToolResult(
        {
          success: false,
          message:
            'Invalid slug format. Only alphanumeric characters, hyphens, and underscores are allowed.',
        },
        {
          newMessages: [
            {
              role: 'system',
              content: '错误: slug 格式无效。只允许字母、数字、连字符和下划线。',
            },
          ],
        }
      );
    }

    try {
      // 获取git根目录
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      // 创建worktree路径
      const worktreePath = join(gitRoot, '..', `${slug}-worktree`);

      // 检查worktree是否已存在
      if (existsSync(worktreePath)) {
        return createToolResult(
          {
            success: false,
            message: `Worktree "${slug}" already exists at ${worktreePath}`,
          },
          {
            newMessages: [
              {
                role: 'system',
                content: `Worktree "${slug}" 已存在于 ${worktreePath}`,
              },
            ],
          }
        );
      }

      // 创建分支名称
      const branchName = branch || `worktree/${slug}`;

      // 检查分支是否存在
      try {
        execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
          stdio: 'pipe',
        });
      } catch {
        // 分支不存在，创建新分支
        execSync(`git branch ${branchName}`, { stdio: 'pipe' });
      }

      // 创建worktree
      execSync(`git worktree add "${worktreePath}" ${branchName}`, {
        stdio: 'pipe',
      });

      return createToolResult(
        {
          success: true,
          message: `Worktree "${slug}" created at ${worktreePath}`,
          worktree_path: worktreePath,
          branch: branchName,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `Worktree "${slug}" 已创建在 ${worktreePath}，基于分支 ${branchName}`,
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
          message: `Failed to create worktree: ${errorMessage}`,
        },
        {
          newMessages: [
            {
              role: 'system',
              content: `创建worktree失败: ${errorMessage}`,
            },
          ],
        }
      );
    }
  }

  override userFacingName(): string {
    return '进入Worktree';
  }

  override getActivityDescription(input?: Partial<EnterWorktreeInput>): string | null {
    if (input?.slug) {
      return `创建worktree ${input.slug}`;
    }
    return '创建worktree';
  }
}

/**
 * 创建进入Worktree工具实例
 */
export function createEnterWorktreeTool(): EnterWorktreeTool {
  return new EnterWorktreeTool();
}
