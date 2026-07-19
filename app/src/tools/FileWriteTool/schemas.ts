import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\FileWriteTool\schemas',
  level: LogLevel.INFO,
});

/**
 * FileWriteTool 输入模式
 */
export const FileWriteInputSchema = z.strictObject({
  filePath: z.string().min(1, '文件路径不能为空').describe('要写入的文件路径'),
  content: z.string().describe('文件内容'),
});

export type FileWriteInputType = z.infer<typeof FileWriteInputSchema>;

/**
 * FileWriteTool 输出模式
 */
export const FileWriteOutputSchema = z.object({
  type: z.enum(['create', 'update']).describe('操作类型：创建或更新'),
  filePath: z.string().describe('写入的文件路径'),
  sizeBytes: z.number().int().nonnegative().describe('文件大小（字节）'),
  linesWritten: z.number().int().nonnegative().describe('写入行数'),
});

export type FileWriteOutputType = z.infer<typeof FileWriteOutputSchema>;

/**
 * 验证 FileWriteTool 输入
 */
export function validateFileWriteInput(input: unknown): FileWriteInputType {
  const result = FileWriteInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileWrite输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
