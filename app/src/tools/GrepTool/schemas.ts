import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\GrepTool\schemas');

/**
 * GrepTool 输出模式枚举
 */
export const GrepOutputModeSchema = z.enum([
  'content',
  'files_with_matches',
  'count',
]);
export type GrepOutputModeType = z.infer<typeof GrepOutputModeSchema>;

/**
 * GrepTool 输入模式
 */
export const GrepInputSchema = z.strictObject({
  pattern: z
    .string()
    .min(1, '搜索模式不能为空')
    .describe('用于匹配的正则表达式模式'),
  searchPath: z
    .string()
    .optional()
    .describe('搜索的根目录路径，默认为当前工作目录'),
  include: z.string().optional().describe('文件包含模式'),
  outputMode: GrepOutputModeSchema.optional().describe('输出模式'),
  contextBefore: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('匹配前显示的行数'),
  contextAfter: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('匹配后显示的行数'),
  contextAround: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('匹配前后显示的行数'),
  showLineNumbers: z.boolean().optional().describe('是否显示行号'),
  caseInsensitive: z.boolean().optional().describe('是否忽略大小写'),
  type: z.string().optional().describe('文件类型过滤器'),
  headLimit: z.number().int().positive().optional().describe('最大返回结果数'),
  offset: z.number().int().nonnegative().optional().describe('结果偏移量'),
  multiline: z.boolean().optional().describe('是否启用多行匹配'),
});

export type GrepInputType = z.infer<typeof GrepInputSchema>;

/**
 * GrepTool 输出模式
 */
export const GrepOutputSchema = z.object({
  matches: z.array(z.string()).describe('匹配结果列表'),
  matchCount: z.number().int().nonnegative().describe('匹配总数'),
  fileCount: z.number().int().nonnegative().describe('匹配文件数'),
  truncated: z.boolean().describe('是否被截断'),
  durationMs: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
});

export type GrepOutputType = z.infer<typeof GrepOutputSchema>;

/**
 * 验证 GrepTool 输入
 */
export function validateGrepInput(input: unknown): GrepInputType {
  const result = GrepInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Grep输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
