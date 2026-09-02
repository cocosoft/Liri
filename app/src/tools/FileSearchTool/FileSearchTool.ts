/**
 * FileSearchTool - 文件搜索工具
 *
 * 基于 Glob 模式匹配文件路径，返回含标准化绝对路径的搜索结果。
 * 对标 GlobTool 但返回格式更丰富（含 canonicalPath），
 * 与 FileReadTool/FileWriteTool/FileEditTool 的 FileOperationResult 体系一致。
 */
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolResult, FileOperationResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam, ToolTag } from '../types/Tool';
import { PermissionResult, createAllowResult } from '../types/PermissionResult';
import { ValidationResult } from '../types/Tool';
import {
  createSuccessResult,
  createFailureResult,
  checkPathAccessibility,
} from '../utils/ToolUtils';
import { globAsync } from '../GlobTool/GlobTool';
import type { FileSearchInputType } from './schemas';
import { validateFileSearchInput } from './schemas';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:FileSearchTool:FileSearchTool');

/** 搜索结果条目，含 canonicalPath 便于前端定位 */
export interface FileSearchItem extends FileOperationResult {
  /** 匹配到的文件路径（相对于搜索目录） */
  relativePath: string;
}

/**
 * 文件搜索工具
 */
export class FileSearchTool extends BaseTool {
  name = 'file_search';
  description = '使用 glob 模式搜索匹配的文件路径，返回标准化绝对路径';

  override tags = [ToolTag.FILE, ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'pattern',
      type: 'string',
      description: 'Glob 搜索模式，如 **/*.ts、src/**/*.{ts,tsx}',
      required: true,
      example: '**/*.ts',
    },
    {
      name: 'searchPath',
      type: 'string',
      description: '搜索的起始目录路径，默认为当前工作目录',
      required: false,
      default: '.',
      example: './src',
    },
    {
      name: 'maxResults',
      type: 'number',
      description: '最大返回结果数量，默认 100，最大 500',
      required: false,
      default: 100,
      example: 200,
    },
  ];

  override aliases = ['search_files', 'find_files', 'glob'];
  searchTips = ['search', 'find', 'glob', 'files', 'pattern'];

  /**
   * 执行文件搜索
   *
   * 委托 GlobTool 的低层 glob() 函数执行模式匹配，
   * 然后将结果映射为含 relativePath + canonicalPath 的格式。
   */
  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      // 验证输入
      const validated: FileSearchInputType = validateFileSearchInput(input);
      const { pattern, searchPath } = validated;
      const maxResults = validated.maxResults ?? 100;
      const basePath = searchPath || context.options.cwd || process.cwd();

      // 检查搜索目录可访问性
      const pathCheck = checkPathAccessibility(basePath, '搜索目录');
      if (!pathCheck.accessible) {
        return createFailureResult(
          `${pathCheck.reason}${pathCheck.suggestions?.length ? `\n建议: ${pathCheck.suggestions.join('; ')}` : ''}`,
          { executionTime: Date.now() - startTime }
        );
      }

      // 使用 Glob 执行匹配（2026-09-01 根因修复：协作式异步遍历，防大目录阻塞事件循环）
      const result = await globAsync(pattern, basePath);

      // 将 glob 结果映射为含 canonicalPath 的格式
      const resolvedBase = path.resolve(basePath);
      const files: FileSearchItem[] = result.filenames.map((filePath) => {
        const canonical = path.resolve(filePath);
        const relative = path.relative(resolvedBase, canonical);
        return {
          relativePath: relative,
          filePath: filePath,
          canonicalPath: canonical,
        };
      });

      // 应用 maxResults 限制
      const truncated = files.length > maxResults || result.truncated;
      const limitedFiles = files.slice(0, maxResults);

      const output =
        limitedFiles.map((f) => f.canonicalPath).join('\n') || '(空)';

      return createSuccessResult(
        {
          durationMs: result.durationMs,
          numFiles: limitedFiles.length,
          files: limitedFiles,
          truncated,
        },
        {
          executionTime: result.durationMs,
          output,
        }
      );
    } catch (error: unknown) {
      return createFailureResult(
        error instanceof Error ? error.message : String(error),
        {
          executionTime: Date.now() - startTime,
        }
      );
    }
  }

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override validateInput(input: Record<string, unknown>): ValidationResult {
    if (!input.pattern || typeof input.pattern !== 'string') {
      return {
        result: false,
        message: 'pattern 是必填参数且必须是字符串',
      };
    }
    return { result: true };
  }

  override async checkPermissions(
    _input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<PermissionResult> {
    return createAllowResult(_input);
  }

  /**
   * 检查是否为搜索或列出命令
   */
  override isSearchOrReadCommand(_input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: true, isRead: false, isList: true };
  }
}
