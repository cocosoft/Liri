/**
 * 文件读取工具
 */

import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export class FileReadTool extends BaseTool {
  /**
   * 创建文件读取工具实例
   * @returns 文件读取工具实例
   */
  static create(): FileReadTool {
    return new FileReadTool();
  }
  name = 'file_read';
  description = 'Read file content';

  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the file',
      required: true,
      default: '',
    },
    {
      name: 'offset',
      type: 'number',
      description: 'Start line number',
      required: false,
      default: 1,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum number of lines to read',
      required: false,
      default: 1000,
    },
  ];

  override aliases = ['read', 'cat'];
  override searchHint = 'Read content from a file';
  override maxResultSizeChars = Infinity; // 读取工具不需要限制结果大小

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

      if (!existsSync(filePath)) {
        return createToolResult(`File not found: ${filePath}`, {
          newMessages: [
            {
              role: 'system',
              content: `Error: File not found: ${filePath}`,
            },
          ],
        });
      }

      // 报告开始读取
      onProgress?.({
        toolUseID: context.toolUseId || 'file-read-tool',
        data: {
          type: 'file_read',
          file_path: filePath,
          isRunning: true,
          isComplete: false,
        },
      });

      const content = readFileSync(filePath, 'utf-8');

      // 处理偏移和限制
      let result = content;
      if (input.offset || input.limit) {
        const lines = content.split('\n');
        const start = ((input.offset as number) || 1) - 1;
        const end = input.limit
          ? start + (input.limit as number)
          : lines.length;
        result = lines.slice(start, end).join('\n');
      }

      // 报告读取完成
      onProgress?.({
        toolUseID: context.toolUseId || 'file-read-tool',
        data: {
          type: 'file_read',
          file_path: filePath,
          isRunning: false,
          isComplete: true,
        },
      });

      return createToolResult(result, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully read file: ${filePath}`,
          },
        ],
      });
    } catch (error: any) {
      // 报告读取错误
      onProgress?.({
        toolUseID: context.toolUseId || 'file-read-tool',
        data: {
          type: 'file_read',
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
    return true; // 文件读取工具始终是只读的
  }

  override isConcurrencySafe(input?: Record<string, unknown>): boolean {
    return true; // 文件读取工具是并发安全的
  }

  override isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: false, isRead: true }; // 文件读取工具是读取命令
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
      return `Read: ${filePath}`;
    }
    return this.name;
  }

  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    if (filePath) {
      return `Reading file: ${filePath}`;
    }
    return null;
  }

  override getToolUseSummary(input?: Partial<Record<string, unknown>>): string | null {
    const filePath = (input?.file_path as string) || '';
    if (filePath) {
      return `Read file: ${filePath}`;
    }
    return null;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }
}
