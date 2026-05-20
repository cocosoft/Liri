/**
 * Glob 工具
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam, ToolTag } from '../types/Tool';
import { PermissionResult, createAllowResult } from '../types/PermissionResult';
import { ValidationResult } from '../types/Tool';
import { createSuccessResult, createFailureResult } from '../utils/ToolUtils';

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
      const path = (input.path as string) || '.';
      const cwd = context.options.cwd || process.cwd();

      const files = await new Promise<string[]>((resolve, reject) => {
        const glob = require('glob');
        glob(
          pattern,
          { cwd, absolute: true },
          (err: any, matches: string[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(matches);
            }
          }
        );
      });

      return createSuccessResult(files, {
        executionTime: Date.now() - startTime,
        output: files.join('\n'),
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
