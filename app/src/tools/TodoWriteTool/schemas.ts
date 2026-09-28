import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\TodoWriteTool\schemas');

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
  action: z
    .enum(['list', 'add', 'update', 'delete', 'clear_completed', 'write'])
    .describe('操作类型'),
  session_id: z.string().optional().default('default').describe('会话ID'),
  todo_id: z.string().optional().describe('待办项ID（更新或删除时需要）'),
  content: z.string().optional().describe('待办内容'),
  status: TodoStatusSchema.optional().default('pending').describe('待办状态'),
  priority: TodoPrioritySchema.optional().default('medium').describe('优先级'),
  todos: z
    .array(
      z.object({
        content: z.string().describe('待办内容'),
        status: TodoStatusSchema.optional()
          .default('pending')
          .describe('待办状态'),
        priority: TodoPrioritySchema.optional()
          .default('medium')
          .describe('优先级'),
      })
    )
    .optional()
    .describe('批量待办数组（write操作时使用）'),
});

/**
 * ⚠️ 本文件原有的 `TodoWriteOutputSchema`（`{todos, updated}`）已于 2026-09-28 删除（T4）。
 *
 * 原因（实证）：该工具的**真实出口是字符串** —— 成功分支恒为提示文案
 * （如 `TodoWriteTool.ts:716/855/896`），5 个失败分支传 `null`
 * （`:686/881/919/1014/1037`，由「无载荷不校验」规则排除）。原 schema 的字段名
 * （`todos`/`updated`）与出口**不一致**，属错层定义 ⇒ 一旦被误接必定每次误报。
 *
 * 出口契约已就地声明在工具上：`TodoWriteTool.ts:420` = `z.string()`。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T4）。
 */

export type TodoWriteInputType = z.infer<typeof TodoWriteInputSchema>;

/**
 * 验证 TodoWriteTool 输入
 */
export function validateTodoWriteInput(input: unknown): TodoWriteInputType {
  const result = TodoWriteInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `TodoWrite输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
