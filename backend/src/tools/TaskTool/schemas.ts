import { z } from 'zod';

/**
 * TaskCreate Schema
 */
export const TaskCreateInputSchema = z.strictObject({
  subject: z.string().min(1).max(500).describe('任务主题（简要标题）'),
  description: z.string().optional().describe('任务详细描述'),
  activeForm: z
    .string()
    .optional()
    .describe('进行中时显示的主动词（如 "Running tests"）'),
  metadata: z.record(z.unknown()).optional().describe('附加到任务的任意元数据'),
});

export const TaskCreateOutputSchema = z.object({
  task: z.object({
    id: z.string().describe('创建的任务 ID'),
    subject: z.string().describe('任务主题'),
  }),
});

/**
 * TaskGet Schema
 */
export const TaskGetInputSchema = z.strictObject({
  id: z.string().min(1).describe('要获取的任务 ID'),
});

export const TaskOutputSchema = z.object({
  id: z.string().describe('任务 ID'),
  subject: z.string().describe('任务主题'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
    .describe('任务状态'),
  description: z.string().optional().describe('任务描述'),
  activeForm: z.string().optional().describe('主动词'),
  priority: z
    .enum(['low', 'medium', 'high', 'urgent'])
    .optional()
    .describe('任务优先级'),
  blockedBy: z
    .array(z.string())
    .optional()
    .describe('阻塞当前任务的其他任务 ID 列表'),
  owner: z.string().optional().describe('任务所有者'),
  metadata: z.record(z.unknown()).optional().describe('任务元数据'),
  createdAt: z.number().optional().describe('创建时间戳'),
  updatedAt: z.number().optional().describe('更新时间戳'),
});

/**
 * TaskList Schema
 */
export const TaskListInputSchema = z.strictObject({});

export const TaskListOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().describe('任务 ID'),
      subject: z.string().describe('任务主题'),
      status: z
        .enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
        .describe('任务状态'),
      owner: z.string().optional().describe('任务所有者'),
      blockedBy: z.array(z.string()).describe('阻塞任务 ID 列表'),
    })
  ),
});

/**
 * TaskUpdate Schema
 */
export const TaskUpdateInputSchema = z.strictObject({
  id: z.string().min(1).describe('要更新的任务 ID'),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
    .optional()
    .describe('新状态'),
  subject: z.string().optional().describe('新主题'),
  description: z.string().optional().describe('新描述'),
  activeForm: z.string().optional().describe('新主动词'),
  priority: z
    .enum(['low', 'medium', 'high', 'urgent'])
    .optional()
    .describe('新优先级'),
  blockedBy: z.array(z.string()).optional().describe('阻塞任务 ID 列表'),
  metadata: z.record(z.unknown()).optional().describe('新元数据'),
});

export const TaskUpdateOutputSchema = z.object({
  task: z.object({
    id: z.string().describe('任务 ID'),
    subject: z.string().describe('任务主题'),
    status: z
      .enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
      .describe('任务状态'),
  }),
});

/**
 * TaskStop Schema
 */
export const TaskStopInputSchema = z.strictObject({
  task_id: z.string().min(1).describe('要停止的任务 ID'),
  force: z.boolean().optional().describe('是否强制停止（立即杀死）'),
});

export const TaskStopOutputSchema = z.object({
  task_id: z.string().describe('任务 ID'),
  previous_status: z.string().describe('停止前的状态'),
  current_status: z.string().describe('当前状态'),
  success: z.boolean().describe('是否成功'),
  message: z.string().describe('操作结果消息'),
});

/**
 * 验证 TaskCreate 输入
 */
export function validateTaskCreateInput(input: unknown) {
  const result = TaskCreateInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false as const,
      error: `输入验证失败: ${errors.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}

/**
 * 验证 TaskGet 输入
 */
export function validateTaskGetInput(input: unknown) {
  const result = TaskGetInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false as const,
      error: `输入验证失败: ${errors.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}

/**
 * 验证 TaskList 输入
 */
export function validateTaskListInput(input: unknown) {
  const result = TaskListInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false as const,
      error: `输入验证失败: ${errors.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}

/**
 * 验证 TaskUpdate 输入
 */
export function validateTaskUpdateInput(input: unknown) {
  const result = TaskUpdateInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false as const,
      error: `输入验证失败: ${errors.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}

/**
 * 验证 TaskStop 输入
 */
export function validateTaskStopInput(input: unknown) {
  const result = TaskStopInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false as const,
      error: `输入验证失败: ${errors.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
