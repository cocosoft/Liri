import { z } from 'zod'

export const SkillInputSchema = z.strictObject({
  name: z.string().min(1).describe('The name of the skill to execute'),
  arguments: z.record(z.unknown()).optional().describe('Arguments to pass to the skill'),
})

export const SkillOutputSchema = z.object({
  name: z.string(),
  result: z.string().optional(),
  success: z.boolean(),
  error: z.string().optional(),
  executionTime: z.number(),
})

export function validateSkillInput(input: unknown) {
  const result = SkillInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
