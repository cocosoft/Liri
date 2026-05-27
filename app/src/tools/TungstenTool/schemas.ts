import { z } from 'zod';

/**
 * TungstenTool 输入模式
 */
export const TungstenInputSchema = z.strictObject({
  action: z
    .enum(['create', 'list', 'switch', 'delete', 'info', 'history'])
    .describe(
      '操作类型：create 创建会话，list 列出会话，switch 切换会话，delete 删除会话，info 查看会话信息，history 查看命令历史'
    ),
  session_name: z.string().optional().describe('新会话名称（create 操作使用）'),
  session_id: z
    .string()
    .optional()
    .describe('会话 ID（switch、delete、info、history 操作使用）'),
});

/**
 * TungstenTool 输出模式
 */
export const TungstenOutputSchema = z.object({
  sessions: z
    .array(
      z.object({
        id: z.string().describe('会话 ID'),
        name: z.string().describe('会话名称'),
        createdAt: z.string().describe('创建时间'),
        lastActivity: z.string().describe('最后活动时间'),
        commandHistory: z.array(z.string()).describe('命令历史列表'),
      })
    )
    .optional()
    .describe('会话列表'),
  activeSession: z.string().nullable().optional().describe('当前活动会话 ID'),
  activeSessionName: z
    .string()
    .nullable()
    .optional()
    .describe('当前活动会话名称'),
});

export type TungstenInput = z.infer<typeof TungstenInputSchema>;
export type TungstenOutput = z.infer<typeof TungstenOutputSchema>;

/**
 * 验证 TungstenTool 输入
 */
export function validateTungstenInput(input: unknown) {
  const result = TungstenInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `TungstenTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  const { action, session_id } = result.data;
  if (
    (action === 'switch' ||
      action === 'delete' ||
      action === 'info' ||
      action === 'history') &&
    !session_id
  ) {
    return {
      success: false as const,
      error: `TungstenTool 输入验证失败: ${action} 操作需要提供 session_id 参数`,
    };
  }
  return { success: true as const, data: result.data };
}
