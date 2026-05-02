import { z } from 'zod'

export const ConfigInputSchema = z.strictObject({
  action: z.enum(['get', 'set', 'delete', 'list']).describe('Configuration action'),
  key: z.string().optional().describe('Configuration key'),
  value: z.unknown().optional().describe('Configuration value (for set action)'),
})

export const ConfigOutputSchema = z.object({
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
})

export function validateConfigInput(input: unknown) {
  const result = ConfigInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
