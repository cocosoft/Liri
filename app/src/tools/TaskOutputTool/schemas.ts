import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\TaskOutputTool\schemas');

/**
 * TaskOutputTool 输入模式
 */
export const TaskOutputInputSchema = z.strictObject({
  task_id: z.string().min(1, '任务ID不能为空').describe('要获取输出的任务ID'),
  block: z.boolean().optional().default(false).describe('是否阻塞等待任务完成'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(300000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒）'),
});

export type TaskOutputInputType = z.infer<typeof TaskOutputInputSchema>;

/**
 * TaskOutputTool 输出-任务数据模式
 */
const TaskOutputDataSchema = z.object({
  task_id: z.string().describe('任务ID'),
  task_type: z.string().describe('任务类型'),
  status: z.string().describe('任务状态'),
  description: z.string().describe('任务描述'),
  output: z.string().describe('任务输出内容'),
  exitCode: z.number().int().nullable().optional().describe('退出码'),
  error: z.string().optional().describe('错误信息'),
  prompt: z.string().optional().describe('触发提示'),
  result: z.string().optional().describe('任务结果'),
});

/**
 * TaskOutputTool 输出模式
 */
export const TaskOutputOutputSchema = z.object({
  retrieval_status: z
    .enum(['success', 'timeout', 'not_ready'])
    .describe('获取状态'),
  task: TaskOutputDataSchema.nullable().describe('任务输出数据'),
});

export type TaskOutputOutputType = z.infer<typeof TaskOutputOutputSchema>;

/**
 * 验证 TaskOutputTool 输入
 */
export function validateTaskOutputInput(input: unknown): TaskOutputInputType {
  const result = TaskOutputInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `TaskOutput输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
