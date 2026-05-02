import { z } from 'zod'

/**
 * EnterPlanModeTool 输入模式（无参数）
 */
export const EnterPlanModeInputSchema = z.strictObject({})

/**
 * EnterPlanModeTool 输出模式
 */
export const EnterPlanModeOutputSchema = z.object({
  success: z.boolean().describe('是否成功进入计划模式'),
  message: z.string().describe('操作结果消息'),
  mode: z.literal('plan').describe('当前模式标识，固定为 plan'),
})

export type EnterPlanModeInput = z.infer<typeof EnterPlanModeInputSchema>
export type EnterPlanModeOutput = z.infer<typeof EnterPlanModeOutputSchema>

/**
 * 验证 EnterPlanModeTool 输入
 */
export function validateEnterPlanModeInput(input: unknown) {
  const result = EnterPlanModeInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `EnterPlanModeTool 输入验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
