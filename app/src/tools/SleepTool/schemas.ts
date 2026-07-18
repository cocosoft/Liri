import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\SleepTool\schemas', level: LogLevel.INFO });

/**
 * SleepTool 输入模式
 */
export const SleepInputSchema = z.strictObject({
  milliseconds: z
    .number()
    .int()
    .positive()
    .max(300000)
    .describe('延迟的毫秒数（上限5分钟）'),
});

export type SleepInputType = z.infer<typeof SleepInputSchema>;

/**
 * SleepTool 输出模式
 */
export const SleepOutputSchema = z.object({
  sleptMs: z.number().int().nonnegative().describe('实际延迟的毫秒数'),
  message: z.string().describe('执行结果消息'),
});

export type SleepOutputType = z.infer<typeof SleepOutputSchema>;

/**
 * 验证 SleepTool 输入
 */
export function validateSleepInput(input: unknown): SleepInputType {
  const result = SleepInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Sleep输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
