// @ts-nocheck
/**
 * Grep 工具
 * 用于在文件中搜索内容
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolParam } from '../types/Tool';
import { PermissionResult, createAllowResult } from '../types/PermissionResult';
import { ValidationResult } from '../types/Tool';
import { createSuccessResult, createFailureResult } from '../utils/ToolUtils';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

export class GrepTool extends BaseTool {
  name = 'grep';
  description = 'Search for patterns in files';

  params: ToolParam[] = [
    {
      name: 'pattern',
      type: 'string',
      description: 'Regex pattern to search for',
      required: true,
      example: 'function',
    },
    {
      name: 'path',
      type: 'string',
      description: 'Directory or file path',
      required: false,
      default: '.',
      example: '.',
    },
    {
      name: 'glob',
      type: 'string',
      description: 'File pattern to search in',
      required: false,
      default: '**/*',
      example: '**/*.ts',
    },
  ];

  aliases = ['search', 'regex'];
  searchTips = ['grep', 'search', 'regex', 'content'];

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();
    try {
      const pattern = input.pattern as string;
      const path = (input.path as string) || '.';
      const globPattern = (input.glob as string) || '**/*';
      const cwd = context.options.cwd || process.cwd();

      const searchPath = resolve(cwd, path);
      const files: string[] = [];

      if (existsSync(searchPath)) {
        const stats = require('fs').statSync(searchPath);
        if (stats.isFile()) {
          files.push(searchPath);
        } else if (stats.isDirectory()) {
          const foundFiles = await new Promise<string[]>((resolve, reject) => {
            const glob = require('glob');
            glob(
              globPattern,
              { cwd: searchPath, absolute: true },
              (err: any, matches: string[]) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(matches);
                }
              }
            );
          });
          files.push(...foundFiles);
        }
      }

      const results: string[] = [];
      const regex = new RegExp(pattern, 'g');

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            if (regex.test(line)) {
              results.push(`${file}:${index + 1}: ${line.trim()}`);
            }
          });
        } catch (error) {
          // 跳过无法读取的文件
        }
      }

      return createSuccessResult(results, {
        executionTime: Date.now() - startTime,
        output: results.join('\n'),
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
