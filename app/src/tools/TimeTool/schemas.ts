import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\TimeTool\schemas');

/**
 * TimeTool 输入模式
 */
export const TimeInputSchema = z.strictObject({
  format: z
    .enum(['iso', 'local', 'unix'])
    .optional()
    .default('local')
    .describe('时间格式'),
  timezone: z
    .string()
    .optional()
    .describe('时区（如 "Asia/Shanghai", "America/New_York"）'),
});

export type TimeInputType = z.infer<typeof TimeInputSchema>;

/**
 * TimeTool 输出模式
 */
export const TimeOutputSchema = z.object({
  time: z.string().describe('当前时间字符串'),
  format: z.string().describe('时间格式'),
  timezone: z.string().describe('时区'),
  timestamp: z.number().int().nonnegative().describe('Unix时间戳（毫秒）'),
});

export type TimeOutputType = z.infer<typeof TimeOutputSchema>;

/**
 * 验证 TimeTool 输入
 */
export function validateTimeInput(input: unknown): TimeInputType {
  const result = TimeInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Time输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
