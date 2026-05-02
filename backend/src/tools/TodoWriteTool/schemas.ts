import { z } from 'zod';

/**
 * Todo 项状态枚举
 */
const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

/**
 * Todo 优先级枚举
 */
const TodoPrioritySchema = z.enum(['high', 'medium', 'low']);

/**
 * TodoWriteTool 输入模式
 */
export const TodoWriteInputSchema = z.strictObject({
  action: z.enum(['list', 'add', 'update', 'delete', 'clear_completed', 'write']).describe('操作类型'),
  session_id: z.string().optional().default('default').describe('会话ID'),
  todo_id: z.string().optional().describe('待办项ID（更新或删除时需要）'),
  content: z.string().optional().describe('待办内容'),
  status: TodoStatusSchema.optional().default('pending').describe('待办状态'),
  priority: TodoPrioritySchema.optional().default('medium').describe('优先级'),
  todos: z.array(z.object({
    content: z.string().describe('待办内容'),
    status: TodoStatusSchema.optional().default('pending').describe('待办状态'),
    priority: TodoPrioritySchema.optional().default('medium').describe('优先级'),
  })).optional().describe('批量待办数组（write操作时使用）'),
});

export type TodoWriteInputType = z.infer<typeof TodoWriteInputSchema>;

/**
 * TodoWriteTool 输出模式
 */
export const TodoWriteOutputSchema = z.object({
  todos: z.array(z.object({
    content: z.string().describe('待办内容'),
    status: TodoStatusSchema.describe('待办状态'),
    priority: TodoPrioritySchema.describe('优先级'),
  })).describe('待办列表'),
  updated: z.boolean().describe('数据是否已更新'),
});

export type TodoWriteOutputType = z.infer<typeof TodoWriteOutputSchema>;

/**
 * 验证 TodoWriteTool 输入
 */
export function validateTodoWriteInput(input: unknown): TodoWriteInputType {
  const result = TodoWriteInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`TodoWrite输入验证失败: ${errors}`);
  }
  return result.data;
}
