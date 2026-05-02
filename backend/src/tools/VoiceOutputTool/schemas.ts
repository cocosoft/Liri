import { z } from 'zod'

/**
 * VoiceOutputTool 输入模式
 */
export const VoiceOutputInputSchema = z.strictObject({
  action: z.enum(['speak', 'stop', 'check']).describe('操作类型：speak 朗读文本，stop 停止朗读，check 检查状态'),
  text: z.string().optional().describe('要朗读的文本内容（speak 操作必需）'),
  voice: z.string().optional().describe('语音名称'),
  speed: z.number().min(0.5).max(2.0).optional().describe('语速，范围 0.5-2.0，默认为 1.0'),
})

/**
 * VoiceOutputTool 输出模式
 */
export const VoiceOutputOutputSchema = z.object({
  spoken: z.boolean().optional().describe('是否已朗读'),
  textLength: z.number().optional().describe('朗读文本长度'),
  stopped: z.boolean().optional().describe('是否已停止'),
  speaking: z.boolean().optional().describe('是否正在朗读'),
  available: z.boolean().optional().describe('语音输出是否可用'),
  languages: z.array(z.string()).optional().describe('支持的语言列表'),
})

export type VoiceOutputInput = z.infer<typeof VoiceOutputInputSchema>
export type VoiceOutputOutput = z.infer<typeof VoiceOutputOutputSchema>

/**
 * 验证 VoiceOutputTool 输入
 */
export function validateVoiceOutputInput(input: unknown) {
  const result = VoiceOutputInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `VoiceOutputTool 输入验证失败: ${issues.join('; ')}` }
  }
  if (result.data.action === 'speak' && !result.data.text) {
    return { success: false as const, error: 'VoiceOutputTool 输入验证失败: speak 操作需要提供 text 参数' }
  }
  return { success: true as const, data: result.data }
}
