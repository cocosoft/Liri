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

  override aliases = ['write', 'echo'];
  override searchHint = 'Write content to a file';
  override maxResultSizeChars = 10000;

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

  override isReadOnly(input?: Record<string, unknown>): boolean {
    return false; // 文件写入工具不是只读的
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return false; // 文件写入工具不是并发安全的
  }

  override isDestructive(input?: Record<string, unknown>): boolean {
    return !input?.append; // 覆盖文件是破坏性操作，追加不是
  }

  override getPath(input: Record<string, unknown>): string {
    return (input.file_path as string) || '';
  }

  override async preparePermissionMatcher(
    input: Record<string, unknown>
  ): Promise<(pattern: string) => boolean> {
    const filePath = (input?.file_path as string) || '';
    return (pattern: string) => {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filePath);
    };
  }

  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const filePath = (input?.file_path as string) || '';
    if (filePath) {
      return `Write: ${filePath}`;
    }
    return this.name;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }

  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    if (filePath) {
      return `${append ? 'Appending to' : 'Writing to'} file: ${filePath}`;
    }
    return null;
  }

  override getToolUseSummary(
    input?: Partial<Record<string, unknown>>
  ): string | null {
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
