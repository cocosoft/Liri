import { z } from 'zod'

export const LSPInputSchema = z.strictObject({
  operation: z.enum([
    'definition', 'references', 'hover', 'callHierarchy', 'symbolSearch',
  ]).describe('LSP operation type'),
  symbol: z.string().min(1).describe('Symbol name to query'),
  file_path: z.string().optional().describe('File path containing the symbol'),
})

export const LSPOutputSchema = z.object({
  symbolName: z.string().optional(),
  symbolKind: z.string().optional(),
  filePath: z.string().optional(),
  references: z.array(z.object({
    file: z.string(),
    line: z.number(),
    column: z.number(),
    text: z.string(),
  })).optional(),
  definition: z.object({
    file: z.string(),
    line: z.number(),
    text: z.string(),
  }).optional(),
  result: z.string().optional(),
})

export function validateLSPInput(input: unknown) {
  const result = LSPInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
