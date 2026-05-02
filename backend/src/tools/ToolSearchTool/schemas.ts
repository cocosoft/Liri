import { z } from 'zod'

/**
 * ToolSearchTool 输入模式
 */
export const ToolSearchInputSchema = z.strictObject({
  query: z.string().min(1).describe('搜索查询。使用 "select:<tool_name>" 进行直接选择，或使用关键词搜索延迟加载的工具'),
  max_results: z.number().int().min(1).max(50).optional().describe('最大返回结果数，默认为 5'),
})

/**
 * ToolSearchTool 输出模式
 */
export const ToolSearchOutputSchema = z.object({
  matches: z.array(z.string()).describe('匹配的工具名称列表'),
  query: z.string().describe('原始查询字符串'),
  total_deferred_tools: z.number().describe('延迟加载工具的总数'),
})

export type ToolSearchInput = z.infer<typeof ToolSearchInputSchema>
export type ToolSearchOutput = z.infer<typeof ToolSearchOutputSchema>

/**
 * 验证 ToolSearchTool 输入
 */
export function validateToolSearchInput(input: unknown) {
  const result = ToolSearchInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `ToolSearchTool 输入验证失败: ${issues.join('; ')}` }
  }
  return { success: true as const, data: result.data }
}
