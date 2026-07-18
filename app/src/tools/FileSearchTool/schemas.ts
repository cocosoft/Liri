/**
 * FileSearchTool 输入输出模式定义
 *
 * 文件搜索工具，基于 Glob 模式匹配文件路径，
 * 返回匹配文件的标准化绝对路径列表。
 */
import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\FileSearchTool\schemas', level: LogLevel.INFO });

/**
 * FileSearchTool 输入模式
 *
 * 支持 Glob 通配符模式（如 ** /*.ts、src/** / *.{ts,tsx}）。
 */
export const FileSearchInputSchema = z.strictObject({
  pattern: z
    .string()
    .min(1, '搜索模式不能为空')
    .describe('用于匹配文件名的通配符模式，支持 glob 语法（*、**、?、{a,b}）'),
  searchPath: z
    .string()
    .optional()
    .describe('搜索的起始目录路径，默认为当前工作目录'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('最大返回结果数量，默认 100，最大 500'),
});

export type FileSearchInputType = z.infer<typeof FileSearchInputSchema>;

/**
 * FileSearchTool 输出模式
 *
 * 每个匹配项包含标准化绝对路径（canonicalPath），
 * 便于前端直接定位文件。
 */
export const FileSearchOutputSchema = z.object({
  durationMs: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
  numFiles: z.number().int().nonnegative().describe('匹配文件数量'),
  files: z
    .array(
      z.object({
        /** 匹配到的文件路径（相对于搜索目录） */
        relativePath: z.string().describe('相对于搜索目录的文件路径'),
        /** 标准化绝对路径 */
        canonicalPath: z.string().describe('文件的标准化绝对路径'),
      })
    )
    .describe('匹配文件列表，含相对路径和绝对路径'),
  truncated: z.boolean().describe('是否因达到 maxResults 上限而被截断'),
});

export type FileSearchOutputType = z.infer<typeof FileSearchOutputSchema>;

/**
 * 验证 FileSearchTool 输入
 */
export function validateFileSearchInput(input: unknown): FileSearchInputType {
  const result = FileSearchInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileSearch 输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
