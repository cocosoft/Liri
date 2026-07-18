import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\MonitorTool\schemas', level: LogLevel.INFO });

/**
 * MonitorTool 输入模式
 */
export const MonitorInputSchema = z.strictObject({
  metric: z
    .enum(['memory', 'cpu', 'disk', 'network'])
    .optional()
    .default('memory')
    .describe('监控指标类型'),
});

export type MonitorInputType = z.infer<typeof MonitorInputSchema>;

/**
 * MonitorTool 输出模式
 */
export const MonitorOutputSchema = z.object({
  metric: z.string().describe('监控指标类型'),
  value: z
    .union([z.number(), z.string(), z.object({}).passthrough()])
    .describe('监控指标值'),
  unit: z.string().optional().describe('单位'),
  timestamp: z.number().int().nonnegative().describe('监控时间戳'),
});

export type MonitorOutputType = z.infer<typeof MonitorOutputSchema>;

/**
 * 验证 MonitorTool 输入
 */
export function validateMonitorInput(input: unknown): MonitorInputType {
  const result = MonitorInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Monitor输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
