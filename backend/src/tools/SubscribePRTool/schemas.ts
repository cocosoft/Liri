import { z } from 'zod';

/**
 * PR 订阅事件类型
 */
const PREventEnum = z.enum(['opened', 'closed', 'merged', 'comment', 'review']);

/**
 * SubscribePRTool 输入模式
 */
export const SubscribePRInputSchema = z.strictObject({
  repo: z.string().min(1).describe('GitHub 仓库名称（如 "owner/repo"）'),
  events: z.array(PREventEnum).min(1).describe('要订阅的事件类型列表'),
  prNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('PR 编号，不提供则订阅所有 PR'),
});

/**
 * SubscribePRTool 输出模式
 */
export const SubscribePROutputSchema = z.object({
  id: z.string().describe('订阅唯一标识'),
  repo: z.string().describe('订阅的仓库名称'),
  prNumber: z.number().optional().describe('订阅的 PR 编号'),
  events: z.array(PREventEnum).describe('订阅的事件类型列表'),
  createdAt: z.number().describe('创建时间戳'),
  active: z.boolean().describe('是否活跃'),
});

export type SubscribePRInput = z.infer<typeof SubscribePRInputSchema>;
export type SubscribePROutput = z.infer<typeof SubscribePROutputSchema>;

/**
 * 验证 SubscribePRTool 输入
 */
export function validateSubscribePRInput(input: unknown) {
  const result = SubscribePRInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `SubscribePRTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
