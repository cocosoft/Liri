/**
 * FileWriteTool - 文件写入工具
 *
 * 编码说明：追加内容时使用 Rust 原生模块自动检测文件编码（UTF-8 / GBK / GB18030），
 * 确保对中文编码文件正确处理。写入时统一采用 UTF-8 编码。
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveOutputDir, resolveInboundDir } from '@modules/core';
import { resolveFilePath } from '../utils/ToolUtils';
import type { FileOperationResult } from '../types/ToolResult';

// 懒初始化 Rust 原生模块，用于自动检测文件编码
let nativeReadFile: ((filePath: string) => string) | null | undefined =
  undefined;

function lazyInitNativeRead(): ((filePath: string) => string) | null {
  if (nativeReadFile === undefined) {
    try {
      const native = require('../../../native');
      if (native && typeof native.readFileWithEncoding === 'function') {
        nativeReadFile = (filePath: string): string => {
          const result = native.readFileWithEncoding(filePath);
          if (result.encoding === 'error') {
            throw new Error(result.error || '编码检测失败');
          }
          return result.content;
        };
      } else {
        nativeReadFile = null;
      }
    } catch (err) {
      handleError(err, {
        module: 'tools:FileWriteTool',
        action: 'initNativeReadFile',
      });
      nativeReadFile = null;
    }
  }
  return nativeReadFile;
}

/**
 * 使用 Rust 原生模块读取文件（自动检测编码），失败时回退到 UTF-8。
 */
function readFileWithEncoding(filePath: string): string {
  const nativeRead = lazyInitNativeRead();
  if (nativeRead) {
    try {
      return nativeRead(filePath);
    } catch (err) {
      handleError(err, {
        module: 'tools:FileWriteTool',
        action: 'readFileWithEncoding',
      });
    }
  }
  return fs.readFileSync(filePath, 'utf-8');
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
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { checkPathAccessibility } from '../utils/ToolUtils';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:FileWriteTool:FileWriteTool');

export class FileWriteTool extends BaseTool {
  name = 'file_write';
  description =
    'Write content to a file. ' +
    'When the content already exists on disk (e.g. another tool produced a local file), ' +
    'you MUST pass source_file instead of reciting the full content as a string — ' +
    'this avoids output token explosion, JSON truncation and memory blow-up.';

  override tags = [ToolTag.FILE, ToolTag.WRITE];

  params: ToolParam[] = [
    {
      name: 'file_path',
      type: 'string',
      description: 'Path to the destination file',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description:
        'Content to write. Required only when source_file is not used.',
      required: false,
    },
    {
      name: 'source_file',
      type: 'string',
      description:
        'Path to an existing local file whose content will be copied to the destination. ' +
        'Use this instead of content whenever the file already exists on disk — ' +
        '0 output tokens, no truncation risk.',
      required: false,
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

      // content 与 source_file 至少提供一个：内容在磁盘时必须优先走 source_file（0 输出 token）
      const hasContent =
        typeof input.content === 'string' &&
        (input.content as string).trim().length > 0;
      const hasSourceFile =
        typeof input.source_file === 'string' &&
        (input.source_file as string).trim().length > 0;
      if (!hasContent && !hasSourceFile) {
        return createToolResult(
          '参数 content 或 source_file 必须提供一个（content 为要写入的正文，source_file 为本地已有文件路径，用于避免复述长内容导致 token 爆炸）',
          {
            newMessages: [
              { role: 'system', content: '缺少参数 content 或 source_file' },
            ],
          }
        );
      }

      // source_file 优先：从磁盘读取，0 输出 token、不截断、不走模型的嘴
      let effectiveContent: string;
      if (hasSourceFile && !hasContent) {
        const src = path.resolve(input.source_file as string);
        if (!fs.existsSync(src)) {
          return createToolResult(`source_file 指定的文件不存在: ${src}`, {
            newMessages: [
              { role: 'system', content: `source_file 不存在: ${src}` },
            ],
          });
        }
        try {
          effectiveContent = readFileWithEncoding(src);
          logger.info('FileWriteTool: source_file 读取成功，写入目标', {
            sourcePath: src,
            destPath: input.file_path as string,
            bytes: Buffer.byteLength(effectiveContent),
            append,
          });
        } catch (e) {
          return createToolResult(
            `source_file 读取失败: ${src}（${e instanceof Error ? e.message : String(e)}）`,
            {
              newMessages: [
                {
                  role: 'system',
                  content: `source_file 读取失败: ${src}`,
                },
              ],
            }
          );
        }
      } else {
        effectiveContent = input.content as string;
      }

      if (append) {
        const resolved = resolveFilePath(input.file_path as string);
        // 使用编码感知的文件读取（自动检测 UTF-8 / GBK / GB18030）
        const existingContent = readFileWithEncoding(resolved);
        writeFile({
          filePath: input.file_path as string,
          content: existingContent + effectiveContent,
        });
      } else {
        writeFile({
          filePath: input.file_path as string,
          content: effectiveContent,
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
    } catch (error) {
      handleError(error, {
        module: 'tools:FileWriteTool',
        action: 'execute',
      });
      const msg = error instanceof Error ? error.message : String(error);
      if (onProgress) {
        onProgress({
          toolUseID: 'file-write-tool',
          data: {
            type: 'file_write',
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
        const { FileRegistry } =
          await import('@modules/services/file/FileRegistry');
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
      } catch (err) {
        handleError(err, {
          module: 'tools:FileWriteTool',
          action: 'registerWriteToFileRegistry',
        });
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
