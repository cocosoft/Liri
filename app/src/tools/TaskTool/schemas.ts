import { z } from 'zod';

/**
 * TaskStop Schema
 *
 * ⚠️ 沿革（2026-09-29，D-15）：本文件原有 TaskCreate / TaskGet / TaskList / TaskUpdate 的
 * 入参 schema、出参 schema 与 `validate*Input`；这 4 个工具类**从未注册进运行时注册表**
 * （`GET /v1/tools` 的 60 个工具内没有它们；活的任务工具是 `TaskOrchestratorTools` 的
 * `create_task_list` / `get_task_list` / `update_task_status`）⇒ 随 4 个类一并删除。
 *
 * 此处只保留**唯一有消费者的** TaskStop schema —— `TaskStopTool.ts:18` 在用，
 * 且其工具名 `task_stop` 确在注册表内。
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
 * 验证 TaskStop 输入
 *
 * ⚠️ 消费方为零（`TaskStopTool` 自带 `validateInput`）—— 与台账 **D-7**「符号级残留」同族；
 * 用户已裁定「保留不动」，故此处不动。
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
