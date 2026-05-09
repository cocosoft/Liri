import { z } from 'zod';

/**
 * VoiceInputTool 输入模式
 */
export const VoiceInputInputSchema = z.strictObject({
  action: z
    .enum(['start', 'stop', 'check'])
    .describe('操作类型：start 开始录音，stop 停止并识别，check 检查状态'),
  language: z.string().optional().describe('识别语言，默认为 zh-CN'),
});

/**
 * VoiceInputTool 输出模式
 */
export const VoiceInputOutputSchema = z.object({
  recording: z.boolean().optional().describe('是否正在录音'),
  language: z.string().optional().describe('识别语言'),
  text: z.string().optional().describe('识别结果文本'),
  confidence: z.number().optional().describe('识别置信度'),
  duration: z.number().optional().describe('音频时长'),
  available: z.boolean().optional().describe('录音功能是否可用'),
  dependenciesAvailable: z.boolean().optional().describe('依赖是否可用'),
  missing: z.array(z.string()).optional().describe('缺失的依赖列表'),
});

export type VoiceInputInput = z.infer<typeof VoiceInputInputSchema>;
export type VoiceInputOutput = z.infer<typeof VoiceInputOutputSchema>;

/**
 * 验证 VoiceInputTool 输入
 */
export function validateVoiceInputInput(input: unknown) {
  const result = VoiceInputInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `VoiceInputTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
