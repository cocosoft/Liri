import { z } from 'zod'

/**
 * ExitWorktreeTool 输入模式
 */
export const ExitWorktreeInputSchema = z.strictObject({
  slug: z.string().min(1).describe('要退出的 worktree 标识符'),
  remove: z.boolean().optional().describe('是否删除 worktree 目录，默认为 false'),
})

/**
 * ExitWorktreeTool 输出模式
 */
export const ExitWorktreeOutputSchema = z.object({
  success: z.boolean().describe('操作是否成功'),
  message: z.string().describe('操作结果消息'),
  previous_branch: z.string().optional().describe('退出前所在的分支名称'),
})

export type ExitWorktreeInput = z.infer<typeof ExitWorktreeInputSchema>
export type ExitWorktreeOutput = z.infer<typeof ExitWorktreeOutputSchema>

/**
 * 验证 ExitWorktreeTool 输入
 */
export function validateExitWorktreeInput(input: unknown) {
  const result = ExitWorktreeInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `ExitWorktreeTool 输入验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
