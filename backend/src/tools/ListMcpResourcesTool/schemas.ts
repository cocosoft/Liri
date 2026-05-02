import { z } from 'zod'

export const ListMcpResourcesInputSchema = z.strictObject({
  server: z.string().optional().describe('按服务器名称过滤资源的可选参数'),
})

export const McpResourceSchema = z.object({
  uri: z.string().describe('资源 URI'),
  name: z.string().describe('资源名称'),
  mimeType: z.string().optional().describe('资源的 MIME 类型'),
  description: z.string().optional().describe('资源描述'),
  server: z.string().describe('提供该资源的服务器名称'),
})

export const ListMcpResourcesOutputSchema = z.array(McpResourceSchema)

export type ListMcpResourcesInput = z.infer<typeof ListMcpResourcesInputSchema>

export type McpResource = z.infer<typeof McpResourceSchema>

/**
 * 验证 ListMcpResources 输入
 */
export function validateListMcpResourcesInput(input: unknown) {
  const result = ListMcpResourcesInputSchema.safeParse(input)
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    )
    return {
      success: false as const,
      error: `输入验证失败: ${errors.join('; ')}`,
    }
  }
  return { success: true as const, data: result.data }
}
