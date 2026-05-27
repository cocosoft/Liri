import { z } from 'zod';

export const AgentInputSchema = z.strictObject({
  description: z
    .string()
    .min(1)
    .max(100)
    .describe('A short (3-5 word) description of the task'),
  prompt: z.string().min(1).describe('The task for the agent to perform'),
  subagent_type: z
    .enum([
      'general',
      'explore',
      'plan',
      'verification',
      'claude-code-guide',
      'statusline-setup',
      'custom',
    ])
    .optional()
    .default('general')
    .describe('The type of specialized agent to use'),
  model: z
    .enum(['sonnet', 'opus', 'haiku'])
    .optional()
    .describe('Optional model override'),
  run_in_background: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set to true to run this agent in the background'),
  name: z.string().optional().describe('Name for the spawned agent'),
  team_name: z.string().optional().describe('Team name for swarm mode'),
  cwd: z.string().optional().describe('Absolute path to run the agent in'),
  isolation: z.enum(['worktree']).optional().describe('Isolation mode'),
});

export const AgentOutputSchema = z.object({
  task_id: z.string().optional(),
  name: z.string().optional(),
  result: z.string().optional(),
  completed: z.boolean(),
  error: z.string().optional(),
});

export function validateAgentInput(input: unknown) {
  const result = AgentInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
