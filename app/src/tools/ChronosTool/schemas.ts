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
 * CronCreateTool 输出模式
 */
export const CronCreateOutputSchema = z.object({
  id: z.string().describe('创建的 cron 任务 ID'),
  humanSchedule: z.string().describe('人类可读的调度描述'),
  recurring: z.boolean().describe('是否重复触发'),
  durable: z.boolean().describe('是否持久化到文件'),
});

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
 * CronListTool 输出模式
 */
export const CronListOutputSchema = z.object({
  jobs: z
    .array(
      z.object({
        id: z.string().describe('任务 ID'),
        cron: z.string().describe('cron 表达式'),
        humanSchedule: z.string().describe('人类可读的调度描述'),
        prompt: z.string().describe('任务提示词'),
        recurring: z.boolean().optional().describe('是否重复触发'),
        durable: z.boolean().optional().describe('是否持久化到文件'),
      })
    )
    .describe('cron 任务列表'),
});

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
