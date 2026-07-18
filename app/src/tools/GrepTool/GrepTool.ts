/**
 * GrepTool - 代码/文件内容搜索工具
 *
 * 使用正则表达式在文件中搜索文本内容，基于低层 grep() 函数实现。
 * 对标 FileSearchTool（基于 Glob 的文件名搜索），
 * 本工具专注于文件内容搜索，返回含匹配行内容的结果。
 *
 * MIT License
 * Copyright (c) 2026 Liri
 */
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam, ToolTag } from '../types/Tool';
import { PermissionResult, createAllowResult } from '../types/PermissionResult';
import { ValidationResult } from '../types/Tool';
import {
  createSuccessResult,
  createFailureResult,
  checkPathAccessibility,
  normalizeToolPath,
} from '../utils/ToolUtils';
import { grep } from './grep';
import type { GrepInputType, GrepOutputType } from './schemas';
import { validateGrepInput } from './schemas';
import { getDescription } from './prompt';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:GrepTool:GrepTool', level: LogLevel.INFO });

/**
 * 代码/文件内容搜索工具
 */
export class GrepTool extends BaseTool {
  name = 'grep';
  description = getDescription();

  override tags = [ToolTag.CODE, ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'pattern',
      type: 'string',
      description: '用于匹配的正则表达式模式',
      required: true,
      example: 'function',
    },
    {
      name: 'searchPath',
      type: 'string',
      description: '搜索的根目录路径，默认为当前工作目录',
      required: false,
      default: '.',
      example: './src',
    },
    {
      name: 'include',
      type: 'string',
      description: '文件包含模式（通配符，如 *.ts, *.{ts,tsx}）',
      required: false,
      example: '*.ts',
    },
    {
      name: 'outputMode',
      type: 'string',
      description:
        '输出模式: content（内容）、files_with_matches（仅文件名）、count（计数）',
      required: false,
      default: 'files_with_matches',
      example: 'content',
    },
    {
      name: 'contextAround',
      type: 'number',
      description: '匹配前后各显示的行数',
      required: false,
      default: 0,
      example: 3,
    },
    {
      name: 'caseInsensitive',
      type: 'boolean',
      description: '是否忽略大小写',
      required: false,
      default: false,
      example: true,
    },
    {
      name: 'headLimit',
      type: 'number',
      description: '最大返回结果数，默认 200',
      required: false,
      default: 200,
      example: 100,
    },
    {
      name: 'multiline',
      type: 'boolean',
      description: '是否启用多行匹配模式',
      required: false,
      default: false,
      example: false,
    },
    {
      name: 'type',
      type: 'string',
      description: '文件类型过滤（如 ts, js, rs, py）',
      required: false,
      example: 'ts',
    },
  ];

  override aliases = ['search', 'regex', 'find_text'];
  searchTips = ['grep', 'search', 'regex', 'content'];

  /**
   * 执行文件内容搜索
   *
   * 委托低层 grep() 函数执行搜索，结果含匹配文件路径、行号和内容。
   */
  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      // 验证输入
      const validated: GrepInputType = validateGrepInput(input);
      const searchPath = normalizeToolPath(
        validated.searchPath || context.options.cwd || process.cwd()
      );

      // 检查搜索目录可访问性
      const pathCheck = checkPathAccessibility(searchPath, '搜索目录');
      if (!pathCheck.accessible) {
        return createFailureResult(
          `${pathCheck.reason}${pathCheck.suggestions?.length ? `\n建议: ${pathCheck.suggestions.join('; ')}` : ''}`,
          { executionTime: Date.now() - startTime }
        );
      }

      // 执行搜索
      const result = grep({
        pattern: validated.pattern,
        searchPath,
        include: validated.include,
        outputMode: validated.outputMode || 'files_with_matches',
        contextBefore: validated.contextBefore,
        contextAfter: validated.contextAfter,
        contextAround: validated.contextAround,
        showLineNumbers: validated.showLineNumbers !== false,
        caseInsensitive: validated.caseInsensitive,
        type: validated.type,
        headLimit: validated.headLimit ?? 200,
        offset: validated.offset,
        multiline: validated.multiline,
      });

      const output: GrepOutputType = {
        matches: result.matches,
        matchCount: result.matchCount,
        fileCount: result.fileCount,
        truncated: result.truncated,
        durationMs: result.durationMs,
      };

      // 构造可读的输出摘要
      const summary = [
        `搜索 "${validated.pattern}" 完成:`,
        `  - 匹配 ${result.matchCount} 处，分布在 ${result.fileCount} 个文件`,
        `  - 耗时 ${result.durationMs}ms`,
        result.truncated ? '  - (结果已截断，使用 headLimit 调整)' : '',
        '',
        ...result.matches.slice(0, 50),
      ]
        .filter(Boolean)
        .join('\n');

      return createSuccessResult(output, {
        executionTime: result.durationMs,
        output: summary,
      });
    } catch (error: any) {
      return createFailureResult(error.message, {
        executionTime: Date.now() - startTime,
      });
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
   * 检查是否为搜索或读取命令
   */
  override isSearchOrReadCommand(_input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: true, isRead: true };
  }
}
