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
 * U-03（2026-10-19）：`task_output` 的**模型可见出参结构**（JSON Schema），
 * 与 `TaskOutputOutputSchema` 逐字段对齐（改 zod 须同步，用例做键集断言）。
 * `task` 可为 `null`（未就绪/超时分支）。
 */
export const TaskOutputOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    retrieval_status: {
      type: 'string',
      enum: ['success', 'timeout', 'not_ready'],
      description: '获取状态',
    },
    task: {
      type: ['object', 'null'],
      description: '任务输出数据（未就绪/超时分支为 null）',
      properties: {
        task_id: { type: 'string', description: '任务 ID' },
        task_type: { type: 'string', description: '任务类型' },
        status: { type: 'string', description: '任务状态' },
        description: { type: 'string', description: '任务描述' },
        output: { type: 'string', description: '任务输出内容' },
        exitCode: {
          type: ['integer', 'null'],
          description: '退出码（仅命令类任务）',
        },
        error: { type: 'string', description: '错误信息' },
        prompt: { type: 'string', description: '触发提示（仅代理类任务）' },
        result: { type: 'string', description: '任务结果（仅代理类任务）' },
      },
      required: ['task_id', 'task_type', 'status', 'description', 'output'],
    },
  },
  required: ['retrieval_status', 'task'],
};

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
