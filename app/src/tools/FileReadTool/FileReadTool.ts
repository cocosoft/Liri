/**
 * FileReadTool - 文件读取工具
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { getReadProtectionService } from '../../security/files/ReadProtectionService';
import { resolveFilePath } from '../utils/ToolUtils';
import type { FileOperationResult } from '../types/ToolResult';

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

  let content: string;
  try {
    // 使用 Rust 原生模块自动检测文件编码（支持 UTF-8 / GBK / GB18030）
    const native = require('../../../native');
    const result = native.readFileWithEncoding(resolved);
    if (result.encoding === 'error') {
      throw new Error(result.error || '编码检测失败');
    }
    content = result.content;
  } catch (e) {
    // 若原生模块不可用或调用失败，回退到 UTF-8 读取
    try {
      content = fs.readFileSync(resolved, 'utf-8');
    } catch (errUtf8) {
      handleError(errUtf8, {
        module: 'tools:FileReadTool',
        action: 'utf8FallbackRead',
      });
      throw new AppError(
        `读取文件失败: ${e instanceof Error ? e.message : String(e)}`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        '100'
      );
    }
  }
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

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:FileReadTool:FileReadTool');

/** 二进制文件转换结果最大字符数：超过则源头截断（保留头尾，中间省略提示） */
const MAX_CONVERT_OUTPUT_CHARS = 30_000;

/**
 * 截断二进制转换结果
 * 大文档（如 docx 技术规范书）转换结果可达数万 token，直接进入上下文会导致
 * tokenize 开销大、内存峰值高、GC 停顿阻塞事件循环（死机）。此处源头截断，
 * 保留头尾内容并提示可用 offset/limit 分段读取。
 */
function truncateConvertOutput(markdown: string): string {
  if (markdown.length <= MAX_CONVERT_OUTPUT_CHARS) return markdown;
  const headLen = Math.floor(MAX_CONVERT_OUTPUT_CHARS * 0.7);
  const tailLen = MAX_CONVERT_OUTPUT_CHARS - headLen;
  return (
    markdown.slice(0, headLen) +
    `\n\n[... 内容过长，已截断 ${markdown.length - MAX_CONVERT_OUTPUT_CHARS} 字符 ...]\n\n` +
    markdown.slice(-tailLen)
  );
}

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
      name: 'file_id',
      type: 'string',
      description:
        'FileRegistry ID（优先于 file_path 使用，可从 file_list 结果中获取）',
      required: false,
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
      // 如果提供了 file_id，优先从 FileRegistry 解析路径
      const fileId = input.file_id as string | undefined;
      if (fileId) {
        const resolvedPath = await this.resolveFileId(fileId);
        if (resolvedPath) {
          input.file_path = resolvedPath;
        }
      }

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
        // 2026-08-24 修复：二进制转换路径透传 offset/limit——
        // 大文档（如 18 万字符 docx）可按行分段读取全文，不再被 30K 截断只读头尾
        return this.convertFile(
          filePath,
          onProgress,
          input.offset as number | undefined,
          input.limit as number | undefined
        );
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
    } catch (error) {
      handleError(error, {
        module: 'tools:FileReadTool',
        action: 'execute',
      });
      const msg = error instanceof Error ? error.message : String(error);
      if (onProgress) {
        onProgress({
          toolUseID: 'file-read-tool',
          data: {
            type: 'file_read',
            error: msg,
            isRunning: false,
            isComplete: true,
          },
        });
      }
      return createToolResult(msg, {
        newMessages: [{ role: 'system', content: `Error: ${msg}` }],
      });
    }
  }

  private async convertFile(
    filePath: string,
    onProgress?: ToolCallProgress<any>,
    offset?: number,
    limit?: number
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

      const fullMarkdown = result.markdown;

      // 2026-08-24 修复：指定 offset/limit 时按行分段（与文本文件 readFile 的
      // offset/limit 行语义一致）——大文档精读可逐段读取完整内容，中间不再丢失。
      // 未指定时保持原有源头截断（防大文本 tokenize/GC 阻塞事件循环）。
      if (offset !== undefined || limit !== undefined) {
        const lines = fullMarkdown.split('\n');
        const startIdx = Math.max(0, (offset ?? 1) - 1);
        const maxLines = limit ?? lines.length;
        const selected = lines.slice(startIdx, startIdx + maxLines);
        const markdown = selected.join('\n');
        const totalLines = lines.length;
        const endIdx = Math.min(startIdx + maxLines, totalLines);
        const truncated = endIdx < totalLines;
        return createToolResult(markdown, {
          success: true,
          output: markdown,
          newMessages: [
            {
              role: 'system',
              content: `文件 [${filePath}] 已转换为 Markdown（共 ${totalLines} 行），当前返回第 ${startIdx + 1}-${endIdx} 行${
                truncated ? '，可继续用 offset/limit 读取后续段落' : ''
              }`,
            },
          ],
        });
      }

      // 源头截断：限制转换结果进入上下文的体积，避免大文本 tokenize + 高内存 GC 停顿导致事件循环阻塞
      const markdown = truncateConvertOutput(fullMarkdown);

      return createToolResult(markdown, {
        success: true,
        output: markdown,
        newMessages: [
          {
            role: 'system',
            content: `文件 [${filePath}] 为二进制格式，已自动转换为 Markdown${
              markdown !== result.markdown ? '（内容过长已截断）' : ''
            }`,
          },
        ],
      });
    } catch (error) {
      handleError(error, {
        module: 'tools:FileReadTool',
        action: 'convertFile',
      });
      const msg = error instanceof Error ? error.message : String(error);
      return createToolResult(msg, {
        success: false,
        error: msg,
        output: `自动转换失败: ${msg}`,
        newMessages: [{ role: 'system', content: `转换失败: ${msg}` }],
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

  /**
   * 通过 FileRegistry file_id 解析文件路径
   */
  private async resolveFileId(fileId: string): Promise<string | null> {
    try {
      const { FileRegistry } =
        await import('@modules/services/file/FileRegistry');
      const registry = FileRegistry.getInstance();
      await registry.initDatabase();
      const record = await registry.getFileDetail(fileId);
      if (record) {
        return record.savedPath;
      }
    } catch (err) {
      handleError(err, {
        module: 'tools:FileReadTool',
        action: 'resolveFileId',
      });
    }
    return null;
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
   * autoIngestFile — 自动注册文件到 FileRegistry 及知识库
   *
   * 工具读取文件后自动注册到 FileRegistry 统一管理，
   * 并同步到知识库（静默执行，不阻塞工具调用）。
   */
  private autoIngestFile(filePath: string): void {
    Promise.resolve().then(async () => {
      try {
        // Step 1: 注册到 FileRegistry
        const { FileRegistry } =
          await import('@modules/services/file/FileRegistry');
        const registry = FileRegistry.getInstance();
        const { readFile } = await import('fs/promises');
        const { basename } = await import('path');
        const content = await readFile(filePath);
        await registry.registerFile({
          originalName: basename(filePath),
          content,
          source: 'auto_ingest',
          sourceId: filePath,
          description: 'FileReadTool 自动注册',
        });
      } catch (err) {
        handleError(err, {
          module: 'tools:FileReadTool',
          action: 'autoIngestRegister',
        });
      }

      try {
        // Step 2: 知识库同步（原逻辑）
        const { getDefaultIngestionService } =
          await import('../../knowledge/ingestion/FileIngestionService');
        const service = getDefaultIngestionService();
        await service.ingestFile(filePath, 'file_read', {
          skipClassification: true,
        });
      } catch (err) {
        handleError(err, {
          module: 'tools:FileReadTool',
          action: 'autoIngestSync',
        });
      }
    });
  }
}
