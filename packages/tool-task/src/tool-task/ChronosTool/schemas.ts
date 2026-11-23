import { z } from 'zod';

/**
 * CronCreateTool 输入模式
 */
export const CronCreateInputSchema = z.strictObject({
  cron: z
    .string()
    .min(1)
    .describe('标准 5 字段 cron 表达式（如 "*/5 * * * *" 表示每 5 分钟）'),
  prompt: z.string().min(1).describe('每次触发时入队的提示词内容'),
  recurring: z
    .boolean()
    .optional()
    .describe(
      'true 表示重复触发直到删除，false 表示触发一次后自动删除，默认为 true'
    ),
  durable: z
    .boolean()
    .optional()
    .describe(
      'true 表示持久化到文件并在重启后保留，false 表示仅内存驻留，默认为 false'
    ),
});

/**
 * ⚠️ `CronCreateOutputSchema`（`{id, humanSchedule, recurring, durable}`）已于 2026-09-29 删除（T6 分批处置 · 批次 3）。
 *
 * 原因（实证）：该工具出口（`ToolUtils.createSuccessResult`）的 `data` 是
 * `{id, name, humanSchedule, nextRunAt}` ⇒ 相比 schema **缺 `recurring` 与 `durable` 两个必填字段**
 * （多出的 `name`/`nextRunAt` 会被 zod 默认 strip）⇒ 接上必误报。
 *
 * ⚠️ **旁证（同类漂移）**：本文件的**入参** schema 是 `{cron, prompt, recurring, durable}`，
 * 而工具实际读取的是 `input.expression` / `scheduleMode` / `name`（`CronCreateTool.ts:171-172`）
 * ⇒ 入参侧**也**与实现不一致（同 D-7 那类"孤立 schema 与实现脱节"）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * CronDeleteTool 输入模式
 */
export const CronDeleteInputSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .describe('要取消的 cron 任务 ID（由 cron_create 返回）'),
});

/**
 * CronDeleteTool 输出模式
 */
export const CronDeleteOutputSchema = z.object({
  id: z.string().describe('已删除的 cron 任务 ID'),
});

/**
 * U-03（2026-10-19）：四个 cron 工具的**模型可见出参结构**（JSON Schema）。
 *
 * ⚠️ 与 zod 的差异**照实记录**（CS06）：
 * - `cron_create` / `cron_list` 的 zod 出口 schema 已于 2026-09-29 删除（与实现漂移）⇒ 这里按**实际出口**写；
 * - `cron_delete` 的 `CronDeleteOutputSchema` 只声明 `id`，而实际出口是 `{id, name}`
 *   （多出键被 zod 默认 strip，无害）⇒ 这里按**实际出口**写 `id` + `name`。
 */
export const CronCreateOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '新建任务 ID' },
    name: { type: 'string', description: '任务名称' },
    humanSchedule: { type: 'string', description: '人类可读的调度表达式' },
    nextRunAt: { type: 'string', description: '下次运行时间（ISO，可缺省）' },
  },
  required: ['id', 'name', 'humanSchedule'],
};

export const CronDeleteOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '已删除的 cron 任务 ID' },
    name: { type: 'string', description: '已删除的任务名称' },
  },
  required: ['id', 'name'],
};

export const CronListOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      description: '定时任务列表',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 ID' },
          name: { type: 'string', description: '任务名称' },
          schedule: { type: 'string', description: '调度表达式（可读形式）' },
          prompt: { type: 'string', description: '触发时执行的提示词' },
          enabled: { type: 'boolean', description: '是否启用' },
          state: {
            type: 'string',
            description: '任务状态（scheduled/paused/running 等）',
          },
          nextRunAt: { type: 'string', description: '下次运行时间（ISO）' },
          lastRunAt: { type: 'string', description: '上次运行时间（ISO）' },
          silent: { type: 'boolean', description: '是否静默执行' },
        },
        required: [
          'id',
          'name',
          'schedule',
          'prompt',
          'enabled',
          'state',
          'silent',
        ],
      },
    },
    count: { type: 'number', description: '任务条数' },
  },
  required: ['jobs', 'count'],
};

export const CronStopOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '任务 ID' },
    name: { type: 'string', description: '任务名称' },
    state: {
      type: 'string',
      description: '操作后的状态（paused / scheduled 等）',
    },
    nextRunAt: {
      type: 'string',
      description: '恢复后的下次运行时间（ISO，仅 resume 分支）',
    },
  },
  required: ['id', 'name', 'state'],
};

/**
 * CronListTool 输入模式
 */
export const CronListInputSchema = z.strictObject({});

/**
 * ⚠️ `CronListOutputSchema`（`{jobs: [{id, cron, humanSchedule, prompt, …}]}`）已于 2026-09-29 删除（T6 分批处置 · 批次 3）。
 *
 * 原因（实证）：该工具出口的 `data` 是 `{jobs, count}`，而 `jobs[]` 元素实际为
 * `{id, name, schedule, prompt, enabled, state, nextRunAt?, lastRunAt?, silent}`
 * （`CronListTool.ts:37-47`）—— 与 schema 相比：**用 `schedule` 而非 `cron`**，且**没有 `humanSchedule`**
 * （两者在 schema 里都是**必填**）⇒ 接上必误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type CronCreateInput = z.infer<typeof CronCreateInputSchema>;
export type CronDeleteInput = z.infer<typeof CronDeleteInputSchema>;

/**
 * 验证 CronCreateTool 输入
 */
export function validateCronCreateInput(input: unknown) {
  const result = CronCreateInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `CronCreateTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}

/**
 * 验证 CronDeleteTool 输入
 */
export function validateCronDeleteInput(input: unknown) {
  const result = CronDeleteInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `CronDeleteTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}

/**
 * 验证 CronListTool 输入
 */
export function validateCronListInput(input: unknown) {
  const result = CronListInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `CronListTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
