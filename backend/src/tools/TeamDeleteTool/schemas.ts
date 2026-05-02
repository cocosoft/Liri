import { z } from 'zod'

/**
 * TeamDeleteTool 输入模式
 */
export const TeamDeleteInputSchema = z.strictObject({
  team_name: z.string().min(1).describe('要删除的团队名称'),
  force: z.boolean().optional().describe('是否强制删除（即使团队中有活跃 teammates），默认为 false'),
})

/**
 * TeamDeleteTool 输出模式
 */
export const TeamDeleteOutputSchema = z.object({
  success: z.boolean().describe('操作是否成功'),
  message: z.string().describe('操作结果消息'),
  team_name: z.string().describe('已删除的团队名称'),
  terminated_teammates: z.array(z.string()).optional().describe('已终止的 teammate 名称列表'),
})

export type TeamDeleteInput = z.infer<typeof TeamDeleteInputSchema>
export type TeamDeleteOutput = z.infer<typeof TeamDeleteOutputSchema>

/**
 * 验证 TeamDeleteTool 输入
 */
export function validateTeamDeleteInput(input: unknown) {
  const result = TeamDeleteInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `TeamDeleteTool 输入验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
