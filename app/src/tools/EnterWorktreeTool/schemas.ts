import { z } from 'zod';

/**
 * EnterWorktreeTool 输入模式
 */
export const EnterWorktreeInputSchema = z.strictObject({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe(
      'Worktree 标识符（只允许字母、数字、连字符和下划线），用于创建 worktree 目录'
    ),
  branch: z
    .string()
    .optional()
    .describe('基于的分支名称（可选，默认创建新分支 worktree/<slug>）'),
});

/**
 * EnterWorktreeTool 输出模式
 */
export const EnterWorktreeOutputSchema = z.object({
  success: z.boolean().describe('操作是否成功'),
  message: z.string().describe('操作结果消息'),
  worktree_path: z.string().optional().describe('创建的 worktree 路径'),
  branch: z.string().optional().describe('使用的分支名称'),
});

export type EnterWorktreeInput = z.infer<typeof EnterWorktreeInputSchema>;
export type EnterWorktreeOutput = z.infer<typeof EnterWorktreeOutputSchema>;

/**
 * 验证 EnterWorktreeTool 输入
 */
export function validateEnterWorktreeInput(input: unknown) {
  const result = EnterWorktreeInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `EnterWorktreeTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
