import { z } from 'zod';

export const BriefInputSchema = z.strictObject({
  sessionId: z
    .string()
    .optional()
    .describe('Session ID to generate summary for'),
  maxLength: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1000)
    .describe('Maximum summary length'),
  messageCount: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe('Number of recent messages to analyze'),
  summaryType: z
    .enum(['concise', 'detailed', 'actionable'])
    .optional()
    .default('concise')
    .describe('Summary type'),
});

export const BriefOutputSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
});

export function validateBriefInput(input: unknown) {
  const result = BriefInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
