/**
 * FileWriteTool - 文件写入工具
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveOutputDir, resolveInboundDir } from '@modules/core/paths';
import type { FileOperationResult } from '../types/ToolResult';

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolveOutputDir(), filePath);
}

export interface FileWriteInput {
  filePath: string;
  content: string;
}

export interface FileWriteResult extends FileOperationResult {
  type: 'create' | 'update';
  sizeBytes: number;
  linesWritten: number;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

export function writeFile(input: FileWriteInput): FileWriteResult {
  const resolved = resolveFilePath(input.filePath);

  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  if (existed) {
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_FILE_SIZE) {
      throw new AppError(
        `File too large to overwrite: ${(stat.size / 1024 / 1024).toFixed(1)} MiB`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  fs.writeFileSync(resolved, input.content, 'utf-8');

  const lines = input.content.split('\n').length;

  return {
    type: existed ? 'update' : 'create',
    filePath: input.filePath,
    canonicalPath: resolved,
    sizeBytes: Buffer.byteLength(input.content, 'utf-8'),
    linesWritten: lines,
  };
}

import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { checkPathAccessibility } from '../utils/ToolUtils';

export class FileWriteTool extends BaseTool {
  name = 'file_write';
  description = 'Write content to a file';

  override tags = [ToolTag.FILE, ToolTag.WRITE];

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

  override async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      const filePathCheck = checkPathAccessibility(
        path.dirname(input.file_path as string),
        '写入目录'
      );
      if (!filePathCheck.accessible) {
        const msg = filePathCheck.reason || '';
        const hint = filePathCheck.suggestions?.length
          ? `\n建议: ${filePathCheck.suggestions.join('; ')}`
          : '';
        return createToolResult(msg + hint, {
          newMessages: [{ role: 'system', content: `路径不可访问: ${msg}` }],
        });
      }

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
        const resolved = resolveFilePath(input.file_path as string);
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

      // 注册到 FileRegistry（异步执行，不阻塞响应返回）
      this.registerWriteToFileRegistry(input);

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

  /**
   * 将写入的文件注册到 FileRegistry
   * 异步执行，不阻塞工具调用响应
   */
  private registerWriteToFileRegistry(input: Record<string, unknown>): void {
    const filePath = input.file_path as string;
    const content = input.content as string;
    if (!filePath || content === undefined) return;

    Promise.resolve().then(async () => {
      try {
        const { FileRegistry } = await import('@modules/services/file/FileRegistry');
        const { FileSource } = await import('@modules/services/file/types');

        const resolved = resolveFilePath(filePath);
        const registry = FileRegistry.getInstance();
        await registry.initDatabase();

        await registry.registerFile({
          originalName: path.basename(resolved),
          content,
          source: FileSource.TOOL_WRITE,
          sourceId: 'file_write_tool',
          mimeType: 'text/plain',
          description: `FileWriteTool 写入: ${filePath}`,
          storeZone: 'inbound',
        });
      } catch {
        // 静默失败，不干扰工具调用主流程
      }
    });
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
