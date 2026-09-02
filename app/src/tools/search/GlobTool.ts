/**
 * Glob 工具
 *
 * 使用纯 Node.js 实现的 glob 匹配，无外部依赖，
 * 避免 bun build --compile 打包时 npm 包不可用的问题。
 */

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
import { globAsync } from '../GlobTool/GlobTool';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:search:GlobTool');

export class GlobTool extends BaseTool {
  name = 'glob';
  description = 'Find files matching a pattern';

  override tags = [ToolTag.FILE, ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'pattern',
      type: 'string',
      description: 'Glob pattern',
      required: true,
      example: '**/*.ts',
    },
    {
      name: 'path',
      type: 'string',
      description: 'Directory to search in',
      required: false,
      default: '.',
      example: '.',
    },
  ];

  override aliases = ['find', 'files'];
  searchTips = ['glob', 'find', 'files', 'pattern'];

  override async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();
    try {
      const pattern = input.pattern as string;
      const searchPath = normalizeToolPath(
        (input.path as string) || context.options.cwd || process.cwd()
      );

      const pathCheck = checkPathAccessibility(searchPath, '搜索目录');
      if (!pathCheck.accessible) {
        return createFailureResult(
          `${pathCheck.reason}${pathCheck.suggestions?.length ? `\n建议: ${pathCheck.suggestions.join('; ')}` : ''}`,
          { executionTime: Date.now() - startTime }
        );
      }

      const result = await globAsync(pattern, searchPath);

      return createSuccessResult(result.filenames, {
        executionTime: result.durationMs,
        output: result.filenames.join('\n') || '(空)',
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
        message: 'pattern is required and must be a string',
      };
    }
    return { result: true };
  }

  override async checkPermissions(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    return createAllowResult(input);
  }

  /**
   * 检查是否为搜索或列出命令
   */
  override isSearchOrReadCommand(input: Record<string, unknown>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  } {
    return { isSearch: true, isRead: false, isList: true };
  }
}
