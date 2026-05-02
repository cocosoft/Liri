/**
 * 文件写入工具
 */

import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

export class FileWriteTool extends BaseTool {
  /**
   * 创建文件写入工具实例
   * @returns 文件写入工具实例
   */
  static create(): FileWriteTool {
    return new FileWriteTool();
  }
  name = 'file_write';
  description = 'Write content to a file';

  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the file',
      required: true,
      default: '',
    },
    {
      name: 'content',
      type: 'string',
      description: 'Content to write',
      required: true,
      default: '',
    },
    {
      name: 'append',
      type: 'boolean',
      description: 'Append content to file instead of overwriting',
      required: false,
      default: false,
    },
  ];

  aliases = ['write', 'echo'];
  searchHint = 'Write content to a file';
  maxResultSizeChars = 10000;

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      const filePath = resolve(
        context.options?.cwd || process.cwd(),
        input.file_path as string
      );
      const content = input.content as string;
      const append = (input.append as boolean) || false;

      // 报告开始写入
      onProgress?.({
        toolUseID: context.toolUseId || 'file-write-tool',
        data: {
          type: 'file_write',
          file_path: filePath,
          isRunning: true,
          isComplete: false,
        },
      });

      writeFileSync(filePath, content, {
        encoding: 'utf-8',
        flag: append ? 'a' : 'w',
      });

      // 报告写入完成
      onProgress?.({
        toolUseID: context.toolUseId || 'file-write-tool',
        data: {
          type: 'file_write',
          file_path: filePath,
          isRunning: false,
          isComplete: true,
        },
      });

      return createToolResult(
        `File ${append ? 'appended' : 'written'} successfully: ${filePath}`,
        {
          newMessages: [
            {
              role: 'system',
              content: `Successfully ${append ? 'appended to' : 'wrote'} file: ${filePath}`,
            },
          ],
        }
      );
    } catch (error: any) {
      // 报告写入错误
      onProgress?.({
        toolUseID: context.toolUseId || 'file-write-tool',
        data: {
          type: 'file_write',
          error: error.message,
          isRunning: false,
          isComplete: true,
        },
      });

      return createToolResult(error.message, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${error.message}`,
          },
        ],
      });
    }
  }

  /**
   * 检查是否为只读命令
   */
  isReadOnly(input?: Record<string, unknown>): boolean {
    return false; // 文件写入工具不是只读的
  }

  /**
   * 检查是否并发安全
   */
  isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return false; // 文件写入工具不是并发安全的
  }

  /**
   * 检查是否破坏性操作
   */
  isDestructive(input?: Record<string, unknown>): boolean {
    return !input?.append; // 覆盖文件是破坏性操作，追加不是
  }

  /**
   * 获取工具操作的文件路径
   */
  getPath(input: Record<string, unknown>): string {
    return (input.file_path as string) || '';
  }

  /**
   * 准备权限匹配器
   */
  async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const filePath = (input?.file_path as string) || '';
    return (pattern: string) => {
      // 简单的模式匹配，支持通配符
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filePath);
    };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<Record<string, unknown>>): string {
    const filePath = (input?.file_path as string) || '';
    if (filePath) {
      return `Write: ${filePath}`;
    }
    return this.name;
  }

  /**
   * 获取工具用于自动分类器的输入
   */
  toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    if (filePath) {
      return `${append ? 'Appending to' : 'Writing to'} file: ${filePath}`;
    }
    return null;
  }

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<Record<string, unknown>>): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    if (filePath) {
      return `${append ? 'Append to' : 'Write to'} file: ${filePath}`;
    }
    return null;
  }

  /**
   * 获取工具使用摘要文本
   */
  getToolUseSummaryText(input: Record<string, unknown>): string {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    return `${append ? 'Appending to' : 'Writing to'} ${filePath}`;
  }
}
