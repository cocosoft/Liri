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
 * ⚠️ `TungstenOutputSchema`（`{sessions?, activeSession?, activeSessionName?}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：该工具**14 处出口的 `data` 全是字符串或 `null`**（如 `'Created Tungsten session:…'`、
 * `'Deleted session:…'`、拼接的 `output` 文本、以及 6 处 `null`）⇒ 与"对象"schema **完全不符**
 * ⇒ 接上必每次误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type TungstenInput = z.infer<typeof TungstenInputSchema>;

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
