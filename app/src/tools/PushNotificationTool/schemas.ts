import { z } from 'zod';

/**
 * PushNotificationTool 输入模式
 */
export const PushNotificationInputSchema = z.strictObject({
  title: z.string().min(1).describe('通知标题'),
  body: z.string().min(1).describe('通知正文内容'),
  url: z.string().optional().describe('关联链接 URL'),
});

/**
 * 通知信息模式
 */
export const PushNotificationSchema = z.object({
  id: z.string().describe('通知唯一标识'),
  title: z.string().describe('通知标题'),
  body: z.string().describe('通知正文'),
  url: z.string().optional().describe('关联链接'),
  createdAt: z.number().describe('创建时间戳'),
  read: z.boolean().describe('是否已读'),
});

/**
 * PushNotificationTool 输出模式
 */
export const PushNotificationOutputSchema = z.object({
  notification: PushNotificationSchema.nullable().describe(
    '创建的通知对象，功能未启用时为 null'
  ),
});

export type PushNotificationInput = z.infer<typeof PushNotificationInputSchema>;
export type PushNotificationOutput = z.infer<
  typeof PushNotificationOutputSchema
>;

/**
 * 验证 PushNotificationTool 输入
 */
export function validatePushNotificationInput(input: unknown) {
  const result = PushNotificationInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `PushNotificationTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
