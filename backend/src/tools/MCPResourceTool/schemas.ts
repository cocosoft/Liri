import { z } from 'zod'

/**
 * MCPResourceTool 输入模式
 */
export const MCPResourceInputSchema = z.strictObject({
  action: z.enum(['list_resources', 'read_resource', 'list_prompts', 'get_prompt']).describe('操作类型：list_resources 列出资源，read_resource 读取资源，list_prompts 列出提示词，get_prompt 获取提示词'),
  server_name: z.string().optional().describe('MCP 服务器名称（read_resource、list_prompts、get_prompt 操作需要）'),
  uri: z.string().optional().describe('资源 URI（read_resource 操作必需）'),
  prompt_name: z.string().optional().describe('提示词名称（get_prompt 操作必需）'),
  prompt_args: z.record(z.any()).optional().describe('提示词参数（get_prompt 操作使用）'),
})

/**
 * MCPResourceTool 输出模式
 */
export const MCPResourceOutputSchema = z.object({
  success: z.boolean().describe('操作是否成功'),
  resources: z.array(z.any()).optional().describe('资源列表'),
  content: z.any().optional().describe('资源内容'),
  prompts: z.array(z.any()).optional().describe('提示词列表'),
  prompt: z.any().optional().describe('提示词内容'),
  message: z.string().optional().describe('操作消息'),
  error: z.string().optional().describe('错误信息'),
})

export type MCPResourceInput = z.infer<typeof MCPResourceInputSchema>
export type MCPResourceOutput = z.infer<typeof MCPResourceOutputSchema>

/**
 * 验证 MCPResourceTool 输入
 */
export function validateMCPResourceInput(input: unknown) {
  const result = MCPResourceInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return { success: false as const, error: `MCPResourceTool 输入验证失败: ${issues.join('; ')}` }
  }
  const { action, uri, prompt_name } = result.data
  if (action === 'read_resource' && !uri) {
    return { success: false as const, error: 'MCPResourceTool 输入验证失败: read_resource 操作需要提供 uri 参数' }
  }
  if (action === 'get_prompt' && !prompt_name) {
    return { success: false as const, error: 'MCPResourceTool 输入验证失败: get_prompt 操作需要提供 prompt_name 参数' }
  }
  return { success: true as const, data: result.data }
}
