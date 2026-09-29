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
 * ⚠️ `SendMessageOutputSchema`（`{messageId, to, delivered, timestamp}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4a）。
 *
 * 原因（实证）：成功出口先把对象 **`JSON.stringify` 成字符串**再当 `data`
 * （`SendMessageTool.ts` 的 `createToolResult(JSON.stringify({messageId, to, delivered: true, timestamp}), …)`），
 * 两个失败分支传 `null` ⇒ 与"对象"schema **不符**（同 **D-10** 那一类：结构在出口被字符串化）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

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
