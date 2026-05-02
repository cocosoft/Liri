import { z } from 'zod'

/**
 * ExitPlanModeTool 输入模式（无参数）
 */
export const ExitPlanModeInputSchema = z.strictObject({})

/**
 * ExitPlanModeTool 输出模式
 */
export const ExitPlanModeOutputSchema = z.object({
  success: z.boolean().describe('是否成功退出计划模式'),
  message: z.string().describe('操作结果消息'),
  mode: z.literal('normal').describe('当前模式标识，固定为 normal'),
})

export type ExitPlanModeInput = z.infer<typeof ExitPlanModeInputSchema>
export type ExitPlanModeOutput = z.infer<typeof ExitPlanModeOutputSchema>

/**
 * 验证 ExitPlanModeTool 输入
 */
export function validateExitPlanModeInput(input: unknown) {
  const result = ExitPlanModeInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `ExitPlanModeTool 输入验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
