// @ts-nocheck
/**
 * Glob 工具
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam } from '../types/Tool';
import { PermissionResult, createAllowResult } from '../types/PermissionResult';
import { ValidationResult } from '../types/Tool';
import { createSuccessResult, createFailureResult } from '../utils/ToolUtils';

export class GlobTool extends BaseTool {
  name = 'glob';
  description = 'Find files matching a pattern';

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

  aliases = ['find', 'files'];
  searchTips = ['glob', 'find', 'files', 'pattern'];

  async execute(
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

  /**
   * 检查是否只读
   */
  isReadOnly(): boolean {
    return true;
  }

  /**
   * 检查是否并发安全
   */
  isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 验证输入
   */
  validateInput(input: Record<string, unknown>): ValidationResult {
    if (!input.pattern || typeof input.pattern !== 'string') {
      return {
        result: false,
        message: 'pattern is required and must be a string',
      };
    }
    return { result: true };
  }

  /**
   * 检查权限
   */
  async checkPermissions(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    return createAllowResult(input);
  }
}
