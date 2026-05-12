import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * WebSearchTool 输入模式
 */
export const WebSearchInputSchema = z.strictObject({
  query: z.string().min(1, '搜索查询不能为空').describe('搜索查询关键词'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(10)
    .describe('最大返回结果数'),
  language: z
    .string()
    .optional()
    .default('en-US')
    .describe('语言代码（如 "en-US", "zh-CN"）'),
  safeSearch: z
    .boolean()
    .optional()
    .default(true)
    .describe('启用安全搜索过滤成人内容'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(120000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒）'),
});

export type WebSearchInputType = z.infer<typeof WebSearchInputSchema>;

/**
 * WebSearchTool 输出模式
 */
export const WebSearchOutputSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().describe('搜索结果标题'),
        url: z.string().url().describe('搜索结果URL'),
        snippet: z.string().describe('搜索结果摘要'),
      })
    )
    .describe('搜索结果列表'),
  totalResults: z.number().int().nonnegative().describe('结果总数'),
  searchTime: z.number().int().nonnegative().describe('搜索耗时（毫秒）'),
});

export type WebSearchOutputType = z.infer<typeof WebSearchOutputSchema>;

/**
 * 验证 WebSearchTool 输入
 */
export function validateWebSearchInput(input: unknown): WebSearchInputType {
  const result = WebSearchInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `WebSearch输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
