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
