import { z } from 'zod';

/**
 * GlobTool 输入模式
 */
export const GlobInputSchema = z.strictObject({
  pattern: z
    .string()
    .min(1, 'glob模式不能为空')
    .describe('用于匹配文件名的通配符模式'),
  searchPath: z
    .string()
    .optional()
    .describe('搜索的起始目录路径，默认为当前工作目录'),
});

export type GlobInputType = z.infer<typeof GlobInputSchema>;

/**
 * GlobTool 输出模式
 */
export const GlobOutputSchema = z.object({
  durationMs: z.number().int().nonnegative().describe('执行耗时（毫秒）'),
  numFiles: z.number().int().nonnegative().describe('匹配文件数量'),
  filenames: z.array(z.string()).describe('匹配文件路径列表'),
  truncated: z.boolean().describe('是否被截断'),
});

export type GlobOutputType = z.infer<typeof GlobOutputSchema>;

/**
 * 验证 GlobTool 输入
 */
export function validateGlobInput(input: unknown): GlobInputType {
  const result = GlobInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Glob输入验证失败: ${errors}`);
  }
  return result.data;
}
