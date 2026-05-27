import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * TaskStopTool 输入模式
 */
export const TaskStopInputSchema = z.strictObject({
  task_id: z.string().optional().describe('要停止的后台任务的ID'),
  shell_id: z.string().optional().describe('已弃用：请使用 task_id 代替'),
});

export type TaskStopInputType = z.infer<typeof TaskStopInputSchema>;

/**
 * TaskStopTool 输出模式
 */
export const TaskStopOutputSchema = z.object({
  message: z.string().describe('关于操作的状态消息'),
  task_id: z.string().describe('被停止的任务的ID'),
  task_type: z.string().describe('被停止的任务的类型'),
  command: z.string().optional().describe('被停止的任务的命令或描述'),
});

export type TaskStopOutputType = z.infer<typeof TaskStopOutputSchema>;

/**
 * 验证 TaskStopTool 输入
 */
export function validateTaskStopInput(input: unknown): TaskStopInputType {
  const result = TaskStopInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `TaskStop输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
