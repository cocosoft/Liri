import { z } from 'zod';

export const NotebookEditInputSchema = z.strictObject({
  notebook_path: z.string().min(1).describe('Path to the notebook file'),
  action: z
    .enum(['add', 'remove', 'update', 'execute'])
    .describe('Operation type'),
  cell_index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Cell index for remove/update actions'),
  cell_type: z.enum(['markdown', 'code']).optional().describe('Cell type'),
  cell_content: z.string().optional().describe('Cell content'),
  cell_output: z.unknown().optional().describe('Cell execution output'),
});

export const NotebookEditOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  error: z.string().optional(),
});

export function validateNotebookEditInput(input: unknown) {
  const result = NotebookEditInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
