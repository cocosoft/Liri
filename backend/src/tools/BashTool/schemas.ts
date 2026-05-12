import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * BashTool 输入模式
 */
export const BashInputSchema = z.strictObject({
  command: z.string().min(1, '命令不能为空').describe('要执行的Bash命令'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(30000)
    .describe('执行超时时间（毫秒）'),
  cwd: z.string().optional().describe('工作目录'),
  env: z.record(z.string()).optional().describe('环境变量'),
});

export type BashInputType = z.infer<typeof BashInputSchema>;

/**
 * BashTool 输出模式
 */
export const BashOutputSchema = z.object({
  stdout: z.string().describe('标准输出'),
  stderr: z.string().describe('错误输出'),
  exitCode: z.number().int().describe('退出码'),
});

export type BashOutputType = z.infer<typeof BashOutputSchema>;

/**
 * 验证 BashTool 输入
 */
export function validateBashInput(input: unknown): BashInputType {
  const result = BashInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(`Bash输入验证失败: ${errors}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  }
  return result.data;
}
