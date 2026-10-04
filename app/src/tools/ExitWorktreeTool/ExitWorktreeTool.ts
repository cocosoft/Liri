/**
 * 退出Worktree工具
 * 用于退出worktree并返回原分支
 * 参考CC源码 cc_code/backend/tools/ExitWorktreeTool/ExitWorktreeTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import { exitWorktree, isInsideGitRepo } from '@modules/workspaces/commands/session';
import { ExitWorktreeOutputSchema } from './schemas';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:ExitWorktreeTool:ExitWorktreeTool');

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
  name = 'exit_worktree';

  /**
   * 出参契约（P1-3 A 档；2026-09-29 **T6 批次 2 接线**）。
   *
   * 该 schema **早已存在却零消费者**。实测出口 `data` **全为同一骨架**
   * `{success, message, previous_branch?}`：成功分支 3 字段全给；
   * 3 个失败分支为 `{success:false, message}`（可选字段缺省，符合 schema）⇒ 接线。
   */
  outputSchema = ExitWorktreeOutputSchema;

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
    // 检查是否在 git 仓库中（同步 fs 探测：替代 spawn `git rev-parse --git-dir`，避免阻塞事件循环）
    return isInsideGitRepo();
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
      const result = await exitWorktree(slug, remove, process.cwd());

      if (result.success) {
        return createToolResult(
          {
            success: true,
            message: result.message || 'Worktree removed',
            previous_branch: (result.data as Record<string, unknown>)
              ?.previous_branch as string,
          },
          {
            newMessages: [
              { role: 'system', content: result.message || 'Worktree removed' },
            ],
          }
        );
      }

      return createToolResult(
        { success: false, message: result.error || result.message || 'Failed' },
        {
          newMessages: [
            {
              role: 'system',
              content: result.error || result.message || 'Failed',
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

  override getActivityDescription(
    input?: Partial<ExitWorktreeInput>
  ): string | null {
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
