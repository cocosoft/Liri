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
import { grep, grepAsync } from './grep';
import type { GrepInputType, GrepOutputType } from './schemas';
import { validateGrepInput } from './schemas';
import { getDescription } from './prompt';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:GrepTool:GrepTool');

/**
 * BUG-05 深化：grep 专属"重复 pattern 短路"。
 * 同一搜索键（路径+pattern+include+输出模式）在短窗口内重复调用时，跳过真实搜索并提示，
 * 从源头拦截 agent 空转反复搜同一批内容的模式（LoopDetector 的 steering 在循环层兜底，本层更前置）。
 * 用模块级缓存，不依赖工具实例生命周期，保证跨调用/多实例共享。
 */
const GREP_DUP_WINDOW_MS = 60_000;
/** 重复检测缓存上限（防内存增长；超限直接清空，只丢窗口缓存不丢真实结果） */
const GREP_DUP_CACHE_MAX = 200;
const grepRecentSearchAt = new Map<string, number>();

/**
 * 构造搜索去重键：路径 + pattern + include + 输出模式 + 分页/上下文参数。
 * 纳入 offset/headLimit/contextAround：同一 pattern 的翻页续搜（不同 offset/headLimit）或
 * 不同上下文行数的展示请求不是「重复搜索」，计入键内避免被误判短路（结论2）。
 */
function grepSearchKey(input: {
  searchPath: string;
  pattern: string;
  include?: string;
  outputMode?: string;
  offset?: number;
  headLimit?: number;
  contextAround?: number;
}): string {
  return [
    input.searchPath,
    input.pattern,
    input.include ?? '',
    input.outputMode ?? 'files_with_matches',
    input.offset ?? 0,
    input.headLimit ?? 0,
    input.contextAround ?? 0,
  ].join('|');
}

/**
 * O3-3（2026-09-24「会话暴露问题分析与优化方案」§五）：**空结果的可执行诊断**（纯函数，导出便于单测）。
 *
 * 现象：导出记录中出现大量空结果后模型换关键词继续重试（空转轮次，见问题清单 P3）——
 * 原返回体只说"匹配 0 处"，不给"搜了哪里 / 为什么可能搜不到 / 下一步怎么改"。
 */
export function buildEmptyResultDiagnostic(params: {
  pattern: string;
  searchPath: string;
  include?: string;
}): string {
  return [
    '',
    `⚠️ 本次搜索（pattern: ${params.pattern}）无匹配。可执行诊断：`,
    `  - 已搜索路径：${params.searchPath}`,
    `  - include 筛选：${params.include ?? '(未限制)'}`,
    '  - 递归搜索请用双星前缀（如 `**/*.ts`）；单星 `*.ts` 只匹配搜索目录的**根层**',
    '  - 中文/Unicode 范围请用 `[\\u4e00-\\u9fa5]`（勿用 `{...}` 写法）',
    '  - 建议：先用更短的唯一关键词定位文件，再逐步收紧 pattern；重复同一 pattern 会被去重短路',
  ].join('\n');
}

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
      description: '搜索的根目录路径（兼容别名 path），默认为当前工作目录',
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

      // BUG-05 深化：重复 pattern 短窗口短路。同一搜索键在窗口内已搜过则跳过真实搜索，
      // 阻止 agent 反复 grep 同一批 pattern 而空转（结果通常在上下文/上一轮已可见）。
      const searchKey = grepSearchKey({
        searchPath,
        pattern: validated.pattern,
        include: validated.include,
        outputMode: validated.outputMode,
        offset: validated.offset,
        headLimit: validated.headLimit,
        contextAround: validated.contextAround,
      });
      const dupNow = Date.now();
      const dupLastAt = grepRecentSearchAt.get(searchKey);
      const isDup =
        dupLastAt !== undefined && dupNow - dupLastAt < GREP_DUP_WINDOW_MS;
      // 防内存增长：缓存条目过多直接清空（只丢窗口缓存，不影响任何真实结果）
      if (grepRecentSearchAt.size > GREP_DUP_CACHE_MAX) {
        grepRecentSearchAt.clear();
      }
      grepRecentSearchAt.set(searchKey, dupNow);
      if (isDup) {
        logger.warn('grep:repeat_shorted', {
          searchPath,
          pattern: validated.pattern,
          include: validated.include,
          elapsedSinceLastMs: dupNow - dupLastAt,
        });
        return createSuccessResult(
          {
            matches: [],
            matchCount: 0,
            fileCount: 0,
            truncated: false,
            durationMs: 0,
            skipped: true,
          } satisfies GrepOutputType,
          {
            executionTime: 0,
            output:
              `检测到在 ${((dupNow - dupLastAt) / 1000).toFixed(0)}s 内以相同 pattern+include ` +
              `重复搜索 "${validated.pattern}"（路径 ${searchPath}）。重复搜索同一内容常表示空转。` +
              '请基于已获取的结果直接向用户交付结论；确需继续搜索时，请改用更精确/不同的 pattern，' +
              '而不是重复相同的搜索。本次已跳过重复执行。',
          }
        );
      }

      // 执行搜索（2026-08-31 根因修复：改用协作式异步遍历，扫描大型目录时
      // 定期让出事件循环，SSE 心跳保持，避免前端"流式响应超时"误判）
      const result = await grepAsync({
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
        invalidRegex: result.invalidRegex,
        skipped: false,
      };

      // BUG-01/02：正则非法时把原因明确反馈给调用方自纠，而非误导性的空结果
      const invalidNotice = result.invalidRegex
        ? `正则无效: ${result.invalidRegex}\n已按字面量降级搜索（通常为空）。请修正 pattern 语法后重试，例如中文范围用 [\\u4e00-\\u9fa5] 而非 [\\x{4e00}-\\x{9fa5}]。\n\n`
        : '';

      // 构造可读的输出摘要
      const summary = [
        `${invalidNotice}搜索 "${validated.pattern}" 完成:`,
        `  - 匹配 ${result.matchCount} 处，分布在 ${result.fileCount} 个文件`,
        `  - 耗时 ${result.durationMs}ms`,
        result.truncated ? '  - (结果已截断，使用 headLimit 调整)' : '',
        // O3-3：空结果附带可执行诊断（减少"换关键词空转"）
        result.matchCount === 0
          ? buildEmptyResultDiagnostic({
              pattern: validated.pattern,
              searchPath,
              ...(validated.include ? { include: validated.include } : {}),
            })
          : '',
        '',
        ...result.matches.slice(0, 50),
      ]
        .filter(Boolean)
        .join('\n');

      return createSuccessResult(output, {
        executionTime: result.durationMs,
        output: summary,
      });
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
