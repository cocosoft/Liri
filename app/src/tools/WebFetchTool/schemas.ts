import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\WebFetchTool\schemas', level: LogLevel.INFO });

/**
 * WebFetchTool 输入模式
 */
export const WebFetchInputSchema = z.strictObject({
  url: z
    .string()
    .url('URL格式无效')
    .min(1, 'URL不能为空')
    .describe('要获取内容的URL'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
    .optional()
    .default('GET')
    .describe('HTTP请求方法'),
  headers: z.record(z.string()).optional().default({}).describe('HTTP请求头'),
  body: z.string().optional().describe('POST/PUT请求体'),
  timeout: z
    .number()
    .int()
    .positive()
    .max(120000)
    .optional()
    .default(30000)
    .describe('超时时间（毫秒）'),
  maxContentLength: z
    .number()
    .int()
    .positive()
    .max(5000000)
    .optional()
    .default(500000)
    .describe('最大内容长度（字符数）'),
});

export type WebFetchInputType = z.infer<typeof WebFetchInputSchema>;

/**
 * WebFetchTool 输出模式
 */
export const WebFetchOutputSchema = z.object({
  content: z.string().describe('获取到的页面内容（Markdown格式）'),
  url: z.string().url().describe('最终请求URL（可能包含重定向）'),
  statusCode: z.number().int().describe('HTTP状态码'),
  contentType: z.string().optional().describe('内容类型'),
  contentLength: z.number().int().nonnegative().describe('内容长度（字符数）'),
  fetchTime: z.number().int().nonnegative().describe('获取耗时（毫秒）'),
  truncated: z.boolean().describe('内容是否被截断'),
});

export type WebFetchOutputType = z.infer<typeof WebFetchOutputSchema>;

/**
 * 验证 WebFetchTool 输入
 */
export function validateWebFetchInput(input: unknown): WebFetchInputType {
  const result = WebFetchInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `WebFetch输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
