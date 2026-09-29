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
