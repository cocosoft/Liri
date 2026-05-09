/**
 * FileWriteTool - 文件写入工具
 * 基于CC源码 FileWriteTool 模式
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileWriteInput {
  filePath: string;
  content: string;
}

export interface FileWriteResult {
  type: 'create' | 'update';
  filePath: string;
  sizeBytes: number;
  linesWritten: number;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

export function writeFile(input: FileWriteInput): FileWriteResult {
  const resolved = path.resolve(input.filePath);

  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  if (existed) {
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large to overwrite: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`
      );
    }
  }

  fs.writeFileSync(resolved, input.content, 'utf-8');

  const lines = input.content.split('\n').length;

  return {
    type: existed ? 'update' : 'create',
    filePath: resolved,
    sizeBytes: Buffer.byteLength(input.content, 'utf-8'),
    linesWritten: lines,
  };
}

import { BaseTool } from '../BaseTool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';

export class FileWriteTool extends BaseTool {
  name = 'file_write';
  description = 'Write content to a file';
  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the file',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Content to write',
      required: true,
    },
    {
      name: 'append',
      type: 'boolean',
      description: 'Append content to file instead of overwriting',
      required: false,
    },
  ];

  override aliases = ['write', 'echo'];
  override searchHint = 'Write content to a file';
  override maxResultSizeChars = 10000;

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
            filePath: input.file_path as string,
            isRunning: true,
            isComplete: false,
          },
        });
      }

      const append = (input.append as boolean) || false;

      if (append) {
        const resolved = path.resolve(input.file_path as string);
        const existingContent = fs.readFileSync(resolved, 'utf-8');
        writeFile({
          filePath: input.file_path as string,
          content: existingContent + (input.content as string),
        });
      } else {
        writeFile({
          filePath: input.file_path as string,
          content: input.content as string,
        });
      }

      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
            filePath: input.file_path as string,
            isRunning: false,
            isComplete: true,
          },
        });
      }

      const verb = append ? 'appended to' : 'written';
      return createToolResult(`File ${verb} successfully: ${input.file_path}`, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully ${verb} file: ${input.file_path}`,
          },
        ],
      });
    } catch (error: any) {
      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
            error: error.message,
            isRunning: false,
            isComplete: true,
          },
        });
      }
      return createToolResult(error.message, {
        newMessages: [{ role: 'system', content: `Error: ${error.message}` }],
      });
    }
  }

  override isReadOnly(): boolean {
    return false;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  override isDestructive(input?: Record<string, unknown>): boolean {
    return !input?.append;
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
    return filePath ? `Write: ${filePath}` : this.name;
  }

  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    return filePath
      ? `${append ? 'Appending to' : 'Writing to'} file: ${filePath}`
      : null;
  }

  override getToolUseSummary(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    const append = (input?.append as boolean) || false;
    return filePath
      ? `${append ? 'Append to' : 'Write to'} file: ${filePath}`
      : null;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }
}
