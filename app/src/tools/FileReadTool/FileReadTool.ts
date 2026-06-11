/**
 * FileReadTool - 文件读取工具
 */
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { getReadProtectionService } from '../../security/files/ReadProtectionService';
import { resolveOutputDir } from '@modules/core/paths';
import type { FileOperationResult } from '../types/ToolResult';

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolveOutputDir(), filePath);
}

export interface FileReadInput {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface FileReadResult extends FileOperationResult {
  content: string;
  totalLines: number;
  lineCount: number;
  offset: number;
  sizeBytes: number;
  truncated: boolean;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const BLOCKED_PATHS = new Set(['/dev/zero', '/dev/random', '/dev/urandom']);

export function readFile(input: FileReadInput): FileReadResult {
  const resolved = resolveFilePath(input.filePath);

  const readProtection = getReadProtectionService();
  const accessCheck = readProtection.checkReadAccess(resolved);
  if (!accessCheck.allowed) {
    throw new AppError(
      accessCheck.reason || `读取被阻止: ${resolved}`,
      ErrorCategory.FILESYSTEM,
      ErrorSeverity.HIGH,
      '101'
    );
  }

  if (BLOCKED_PATHS.has(resolved)) {
    throw new AppError(
      `Blocked device path: ${resolved}`,
      ErrorCategory.FILESYSTEM,
      ErrorSeverity.HIGH,
      '101'
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new AppError(
      `File not found: ${resolved}`,
      ErrorCategory.FILESYSTEM,
      ErrorSeverity.HIGH,
      '100'
    );
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new AppError(
      `Path is a directory: ${resolved}`,
      ErrorCategory.FILESYSTEM,
      ErrorSeverity.HIGH,
      '105'
    );
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new AppError(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MiB (max 10 MiB)`,
      ErrorCategory.FILESYSTEM,
      ErrorSeverity.MEDIUM,
      '108'
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
    filePath: input.filePath,
    canonicalPath: resolved,
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
import { ToolTag } from '../types/Tool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { getConverterEngine } from '../../tools/converter/engine/ConverterEngine';
import { FileTypeDetector } from '../../tools/converter/engine/FileTypeDetector';
import { checkPathAccessibility } from '../utils/ToolUtils';

const BINARY_EXTENSIONS = new Set([
  '.docx',
  '.xlsx',
  '.xls',
  '.pptx',
  '.pdf',
  '.epub',
  '.zip',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.svg',
  '.webp',
  '.ico',
  '.tiff',
  '.tif',
  '.mp3',
  '.wav',
  '.m4a',
  '.flac',
  '.ogg',
  '.wma',
  '.mp4',
  '.ipynb',
  '.msg',
]);

export class FileReadTool extends BaseTool {
  name = 'file_read';
  description = 'Read file content';

  override tags = [ToolTag.FILE, ToolTag.READ];

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

  override async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      const filePath = resolveFilePath(input.file_path as string);

      const pathCheck = checkPathAccessibility(
        input.file_path as string,
        '文件'
      );
      if (!pathCheck.accessible) {
        const msg = pathCheck.reason || '';
        const hint = pathCheck.suggestions?.length
          ? `\n建议: ${pathCheck.suggestions.join('; ')}`
          : '';
        return createToolResult(msg + hint, {
          newMessages: [{ role: 'system', content: `路径不可访问: ${msg}` }],
        });
      }

      const ext = path.extname(filePath).toLowerCase();

      if (BINARY_EXTENSIONS.has(ext)) {
        return this.convertFile(filePath, onProgress);
      }

      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: {
            type: 'file_read',
            filePath: input.file_path as string,
            isRunning: true,
            isComplete: false,
          },
        });
      }

      const result = readFile({
        filePath: input.file_path as string,
        offset: input.offset as number | undefined,
        limit: input.limit as number | undefined,
      });

      this.autoIngestFile(result.canonicalPath);

      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: {
            type: 'file_read',
            filePath: result.canonicalPath,
            isRunning: false,
            isComplete: true,
          },
        });
      }

      return createToolResult(result.content, {
        newMessages: [
          {
            role: 'system',
            content: `Successfully read file: ${result.canonicalPath}`,
          },
        ],
      });
    } catch (error: any) {
      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: {
            type: 'file_read',
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

  private async convertFile(
    filePath: string,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    try {
      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: {
            type: 'file_convert',
            filePath,
            isRunning: true,
            isComplete: false,
          },
        });
      }

      const engine = getConverterEngine();
      const detector = new FileTypeDetector();
      const stat = fs.statSync(filePath);
      const fileInfo = detector.detect(filePath, stat.size);
      const content = fs.readFileSync(filePath);
      const result = await engine.convertContent(fileInfo, content);

      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: {
            type: 'file_convert',
            filePath,
            isRunning: false,
            isComplete: true,
          },
        });
      }

      this.autoIngestFile(filePath);

      return createToolResult(result.markdown, {
        success: true,
        output: result.markdown,
        newMessages: [
          {
            role: 'system',
            content: `文件 [${filePath}] 为二进制格式，已自动转换为 Markdown`,
          },
        ],
      });
    } catch (error: any) {
      return createToolResult(error.message, {
        success: false,
        error: error.message,
        output: `自动转换失败: ${error.message}`,
        newMessages: [
          { role: 'system', content: `转换失败: ${error.message}` },
        ],
      });
    }
  }

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: false, isRead: true };
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
    return filePath ? `Read: ${filePath}` : this.name;
  }

  override getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Reading file: ${filePath}` : null;
  }

  override getToolUseSummary(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const filePath = (input?.file_path as string) || '';
    return filePath ? `Read file: ${filePath}` : null;
  }

  override toAutoClassifierInput(input: Record<string, unknown>): unknown {
    return (input?.file_path as string) || '';
  }

  /**
   * 文件读取后自动触发知识库摄取
   * 异步执行，不阻塞工具调用
   */
  private autoIngestFile(filePath: string): void {
    Promise.resolve().then(async () => {
      try {
        const { getDefaultIngestionService } =
          await import('../../knowledge/ingestion/FileIngestionService');
        const service = getDefaultIngestionService();
        await service.ingestFile(filePath, 'file_read', {
          skipClassification: true,
        });
      } catch {
        // 静默失败，不干扰主流程
      }
    });
  }
}
