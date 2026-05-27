import { z } from 'zod';

/**
 * SendMessageTool 输入模式
 */
export const SendMessageInputSchema = z.strictObject({
  to: z.string().min(1).describe('目标代理名称'),
  message: z.string().min(1).describe('要发送的消息内容'),
  priority: z
    .enum(['normal', 'high', 'low'])
    .optional()
    .describe('消息优先级，默认为 normal'),
});

/**
 * SendMessageTool 输出模式
 */
export const SendMessageOutputSchema = z.object({
  messageId: z.string().describe('消息唯一标识'),
  to: z.string().describe('目标代理名称'),
  delivered: z.boolean().describe('消息是否成功投递'),
  timestamp: z.number().describe('消息发送时间戳'),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type SendMessageOutput = z.infer<typeof SendMessageOutputSchema>;

/**
 * 验证 SendMessageTool 输入
 */
export function validateSendMessageInput(input: unknown) {
  const result = SendMessageInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `SendMessageTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
