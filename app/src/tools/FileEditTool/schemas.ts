import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\FileEditTool\schemas',
  level: LogLevel.INFO,
});

/**
 * FileEditTool 输入模式
 */
export const FileEditInputSchema = z.strictObject({
  filePath: z.string().min(1, '文件路径不能为空').describe('要编辑的文件路径'),
  oldString: z
    .string()
    .min(1, '旧字符串不能为空')
    .describe('需要被替换的旧字符串'),
  newString: z.string().describe('替换后的新字符串'),
});

export type FileEditInputType = z.infer<typeof FileEditInputSchema>;

/**
 * FileEditTool 输出模式
 */
export const FileEditOutputSchema = z.object({
  filePath: z.string().describe('编辑的文件路径'),
  linesChanged: z.number().int().nonnegative().describe('变更行数'),
  replaced: z.boolean().describe('是否成功替换'),
  oldStringFound: z.boolean().describe('是否找到旧字符串'),
});

export type FileEditOutputType = z.infer<typeof FileEditOutputSchema>;

/**
 * 验证 FileEditTool 输入
 */
export function validateFileEditInput(input: unknown): FileEditInputType {
  const result = FileEditInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileEdit输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
