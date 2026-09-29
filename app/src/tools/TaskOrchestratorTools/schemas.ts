// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TaskOrchestratorTools 出参契约（P1-3 A 档；2026-09-29 建）
 *
 * 沿革：三个工具的出口 `data` 原为**人类可读纯文本字符串**（`create_task_list` 多行清单 /
 * `update_task_status` 单句 / `get_task_list` 对齐表格），与同族 `task_stop` 的**对象**出口不一致
 * ⇒ 同族两形态、且**无法声明结构化契约**。本批统一为对象并按既有 `Tool.outputSchema` 契约位接线
 * （机制与写法对齐 `TaskTool/schemas.ts` 的 `TaskStopOutputSchema`）。
 *
 * 字段语义严格照实有出口，未发明字段；命名对齐同族 `task_stop` 的 snake_case。
 * 失败分支仍 `createToolResult(null, …)` ⇒ **无载荷不校验**（沿用 P1-3 A 档约定）。
 */
import { z } from 'zod';

/** `create_task_list` 出参 */
export const CreateTaskListOutputSchema = z.object({
  created: z
    .array(
      z.object({
        task_id: z.string().describe('新建任务 ID'),
        description: z.string().describe('任务描述（已 trim）'),
      })
    )
    .describe('本次成功创建的任务'),
  total: z.number().describe('创建后注册表内任务总数'),
  pending: z.number().describe('创建后 pending 任务数'),
  skipped: z.number().describe('因 description 为空被跳过的条数'),
});

/** `update_task_status` 出参 */
export const UpdateTaskStatusOutputSchema = z.object({
  task_id: z.string().describe('被更新的任务 ID'),
  status: z
    .string()
    .describe('更新后的状态（pending/in_progress/completed/failed/cancelled）'),
  success: z.boolean().describe('是否成功'),
  message: z.string().describe('操作结果消息'),
});

/** `get_task_list` 出参 */
export const GetTaskListOutputSchema = z.object({
  count: z.number().describe('任务条数（含空列表时的 0）'),
  stats: z
    .object({
      pending: z.number(),
      in_progress: z.number(),
      completed: z.number(),
      failed: z.number(),
      cancelled: z.number(),
    })
    .describe('按显示状态聚合的计数'),
  tasks: z
    .array(
      z.object({
        task_id: z.string(),
        description: z.string(),
        status: z.string().describe('任务的 displayStatus'),
      })
    )
    .describe('任务清单'),
});
