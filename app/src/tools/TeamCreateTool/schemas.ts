import { z } from 'zod';

/**
 * TeamCreateTool 输入模式
 */
export const TeamCreateInputSchema = z.strictObject({
  team_name: z.string().min(1).max(100).describe('团队名称'),
  description: z.string().optional().describe('团队描述/用途说明'),
  agent_type: z
    .string()
    .optional()
    .describe('团队负责人类型/角色（如 researcher, test-runner）'),
});

/**
 * TeamCreateTool 输出模式
 */
export const TeamCreateOutputSchema = z.object({
  team_name: z.string().describe('创建的团队名称'),
  team_file_path: z.string().describe('团队文件路径'),
  lead_agent_id: z.string().describe('团队负责人 Agent ID'),
});

export type TeamCreateInput = z.infer<typeof TeamCreateInputSchema>;
export type TeamCreateOutput = z.infer<typeof TeamCreateOutputSchema>;

/**
 * U-03（2026-10-19）：`team_create` 的**模型可见出参结构**（JSON Schema），
 * 与 `TeamCreateOutputSchema` 逐字段对齐。
 */
export const TeamCreateOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    team_name: { type: 'string', description: '创建的团队名称' },
    team_file_path: { type: 'string', description: '团队文件路径' },
    lead_agent_id: { type: 'string', description: '团队负责人 Agent ID' },
  },
  required: ['team_name', 'team_file_path', 'lead_agent_id'],
};

/**
 * 验证 TeamCreateTool 输入
 */
export function validateTeamCreateInput(input: unknown) {
  const result = TeamCreateInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `TeamCreateTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
