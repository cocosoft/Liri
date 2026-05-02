import { z } from 'zod'

export const ReadMcpResourceInputSchema = z.strictObject({
  server: z.string().describe('MCP 服务器名称'),
  uri: z.string().describe('要读取的资源 URI'),
})

export const ReadMcpResourceOutputSchema = z.object({
  contents: z.array(
    z.object({
      uri: z.string().describe('资源 URI'),
      mimeType: z.string().optional().describe('内容的 MIME 类型'),
      text: z.string().optional().describe('资源的文本内容'),
      blobSavedTo: z.string().optional().describe('二进制 blob 内容保存的路径'),
    })
  ),
})

export type ReadMcpResourceInput = z.infer<typeof ReadMcpResourceInputSchema>

export type ReadMcpResourceOutput = z.infer<typeof ReadMcpResourceOutputSchema>

/**
 * 验证 ReadMcpResource 输入
 */
export function validateReadMcpResourceInput(input: unknown) {
  const result = ReadMcpResourceInputSchema.safeParse(input)
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
