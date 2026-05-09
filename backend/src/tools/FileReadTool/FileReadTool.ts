/**
 * FileReadTool - 文件读取工具
 * 基于CC源码 FileReadTool 模式
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileReadInput {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface FileReadResult {
  content: string;
  filePath: string;
  totalLines: number;
  lineCount: number;
  offset: number;
  sizeBytes: number;
  truncated: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const BLOCKED_PATHS = new Set(['/dev/zero', '/dev/random', '/dev/urandom']);

export function readFile(input: FileReadInput): FileReadResult {
  const resolved = path.resolve(input.filePath);

  if (BLOCKED_PATHS.has(resolved)) {
    throw new Error(`Blocked device path: ${resolved}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory: ${resolved}`);
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB (max 10 MiB)`
    );
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const allLines = content.split('\n');
  const totalLines = allLines.length;
  const offset = input.offset ?? 1;
  const limit = input.limit ?? Math.min(totalLines, 2000);

  const startLine = Math.max(0, offset - 1);
  const endLine = Math.min(totalLines, startLine + limit);
  const selectedLines = allLines.slice(startLine, endLine);

  let result = selectedLines.join('\n');
  if (offset > 1 || limit < totalLines) {
    result = addLineNumbers(result, startLine + 1);
  }

  return {
    content: result,
    filePath: resolved,
    totalLines,
    lineCount: selectedLines.length,
    offset,
    sizeBytes: stat.size,
    truncated: endLine < totalLines,
  };
}

export function addLineNumbers(content: string, startLine: number = 1): string {
  return content
    .split('\n')
    .map((line, i) => `${String(startLine + i).padStart(6, ' ')}  ${line}`)
    .join('\n');
}

import { BaseTool } from '../BaseTool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';

export class FileReadTool extends BaseTool {
  name = 'file_read';
  description = 'Read file content';
  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the file',
      required: true,
    },
    {
      name: 'offset',
      type: 'number',
      description: 'Start line number',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum number of lines to read',
      required: false,
    },
  ];

  override aliases = ['read', 'cat'];
  override searchHint = 'Read content from a file';
  override maxResultSizeChars = Infinity;

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: { type: 'file_read', filePath: input.file_path as string, isRunning: true, isComplete: false },
        });
      }

      const result = readFile({
        filePath: input.file_path as string,
        offset: input.offset as number | undefined,
        limit: input.limit as number | undefined,
      });

      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: { type: 'file_read', filePath: result.filePath, isRunning: false, isComplete: true },
        });
      }

      return createToolResult(result.content, {
        newMessages: [
          { role: 'system', content: `Successfully read file: ${result.filePath}` },
        ],
      });
    } catch (error: any) {
      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: { type: 'file_read', error: error.message, isRunning: false, isComplete: true },
        });
      }
      return createToolResult(error.message, {
        newMessages: [{ role: 'system', content: `Error: ${error.message}` }],
      });
    }
  }

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override isSearchOrReadCommand(input: Record<string, unknown>): { isSearch: boolean; isRead: boolean; isList?: boolean } {
    return { isSearch: false, isRead: true };
  }

  override getPath(input: Record<string, unknown>): string {
    return (input.file_path as string) || '';
  }

  override async preparePermissionMatcher(input: Record<string, unknown>): Promise<(pattern: string) => boolean> {
    const filePath = (input?.file_path as string) || '';
    return (pattern: string) => {
      const regexPattern = pattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filePath);
    };
  }

  override userFacingName(input?: Partial<Record<string, unknown>>): string {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Read: ${filePath}` : this.name;
  }

  override getActivityDescription(input?: Partial<Record<string, unknown>>): string | null {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Reading file: ${filePath}` : null;
  }

  override getToolUseSummary(input?: Partial<Record<string, unknown>>): string | null {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Read file: ${filePath}` : null;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }
}
