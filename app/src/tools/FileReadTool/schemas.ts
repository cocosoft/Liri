import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\FileReadTool\schemas',
  level: LogLevel.INFO,
});

/**
 * FileReadTool 输入模式
 */
export const FileReadInputSchema = z.strictObject({
  filePath: z.string().min(1, '文件路径不能为空').describe('要读取的文件路径'),
  offset: z.number().int().positive().optional().describe('起始行号，从1开始'),
  limit: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('最大读取行数'),
});

export type FileReadInputType = z.infer<typeof FileReadInputSchema>;

/**
 * FileReadTool 输出模式
 */
export const FileReadOutputSchema = z.object({
  content: z.string().describe('文件内容'),
  filePath: z.string().describe('解析后的文件路径'),
  totalLines: z.number().int().nonnegative().describe('文件总行数'),
  lineCount: z.number().int().nonnegative().describe('返回的行数'),
  offset: z.number().int().positive().describe('起始行号'),
  sizeBytes: z.number().int().nonnegative().describe('文件大小（字节）'),
  truncated: z.boolean().describe('是否被截断'),
});

export type FileReadOutputType = z.infer<typeof FileReadOutputSchema>;

/**
 * 验证 FileReadTool 输入
 */
export function validateFileReadInput(input: unknown): FileReadInputType {
  const result = FileReadInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileRead输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
