/**
 * 进入Worktree工具
 * 用于创建并切换到git worktree，为Agent创建隔离的工作区
 * 参考CC源码 cc_code/backend/tools/EnterWorktreeTool/EnterWorktreeTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import {
  enterWorktree,
  isInsideGitRepo,
} from '@modules/workspaces/commands/session';
import { EnterWorktreeOutputSchema } from './schemas';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:EnterWorktreeTool:EnterWorktreeTool');

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
  name = 'enter_worktree';

  /**
   * 出参契约（P1-3 A 档；2026-09-29 **T6 批次 2 接线**）。
   *
   * 该 schema **早已存在却零消费者**。实测出口 `data` **全为同一骨架**
   * `{success, message, worktree_path?, branch?}`：成功分支给全 4 字段；
   * 4 个失败分支为 `{success:false, message}`（两个可选字段缺省，符合 schema）⇒ 接线。
   */
  outputSchema = EnterWorktreeOutputSchema;

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
    // 检查是否在 git 仓库中（同步 fs 探测：替代 spawn `git rev-parse --git-dir`，避免阻塞事件循环）
    return isInsideGitRepo();
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
              content:
                '错误: slug 格式无效。只允许字母、数字、连字符和下划线。',
            },
          ],
        }
      );
    }

    try {
      const result = await enterWorktree(slug, branch, process.cwd());

      if (result.success) {
        return createToolResult(
          {
            success: true,
            message: result.message || 'Worktree created',
            worktree_path: (result.data as Record<string, unknown>)
              ?.worktree_path as string,
            branch: (result.data as Record<string, unknown>)?.branch as string,
          },
          {
            newMessages: [
              {
                role: 'system',
                content: result.message || 'Worktree created',
              },
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

  override getActivityDescription(
    input?: Partial<EnterWorktreeInput>
  ): string | null {
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
