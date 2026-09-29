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

/**
 * ⚠️ `TaskCreateOutputSchema`（`{task: {id, subject}}`）已于 2026-09-29 删除（T6 分批处置 · 批次 1b）。
 *
 * 原因（实证）：该工具**出口 `data` 是 JSON 字符串**（`TaskCreateTool.ts:221` 的
 * `JSON.stringify(output)`；另有 `null` 失败分支 `:191/233`）⇒ 原 schema 描述的是**对象** ⇒
 * **错层定义**，接上必每次误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * TaskGet Schema
 */
export const TaskGetInputSchema = z.strictObject({
  id: z.string().min(1).describe('要获取的任务 ID'),
});

/**
 * ⚠️ `TaskOutputSchema`（任务详情对象，11 字段）已于 2026-09-29 删除（T6 分批处置 · 批次 1b）。
 *
 * 原因（实证）：它服务于 **TaskGet**，而该工具**出口 `data` 是 JSON 字符串**
 * （`TaskGetTool.ts:169` 的 `JSON.stringify(output)`；另有 `null` 失败分支 `:128/145/181`）⇒
 * 描述的是**对象** ⇒ **错层定义**，接上必每次误报。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * TaskList Schema
 */
export const TaskListInputSchema = z.strictObject({});

/**
 * ⚠️ `TaskListOutputSchema`（`{tasks: [{…}]}`）已于 2026-09-29 删除（T6 分批处置 · 批次 1b）。
 *
 * 原因（实证）：该工具**出口 `data` 是 JSON 字符串**（`TaskListTool.ts:117` 的
 * `JSON.stringify(output)`；另有 `null` 分支 `:129`）⇒ 原 schema 描述的是**对象** ⇒
 * **错层定义**，接上必每次误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

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

/**
 * ⚠️ `TaskUpdateOutputSchema`（`{task: {id, subject, status}}`）已于 2026-09-29 删除（T6 分批处置 · 批次 1b）。
 *
 * 原因（实证）：该工具**出口 `data` 是 JSON 字符串**（`TaskUpdateTool.ts:248` 的
 * `JSON.stringify(output)`；另有 `null` 分支 `:188/204`）⇒ 原 schema 描述的是**对象** ⇒
 * **错层定义**，接上必每次误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

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
