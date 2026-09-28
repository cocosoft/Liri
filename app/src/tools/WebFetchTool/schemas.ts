import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\WebFetchTool\schemas');

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

/**
 * ⚠️ 本文件原有的 `WebFetchOutputSchema` 已于 2026-09-28 删除（T4）。
 *
 * 原因（实证）：该工具出口是**混合形态**，且 6 个失败分支**均未标 `success: false`**
 * ⇒ 全部会进入 `ToolExecutor` 的出参校验，单一 schema 无法表达：
 *  - **失败分支**（字符串 `data`）：`WebFetchTool.ts:181/192/220/287/374/399`；
 *  - **成功分支**（对象）：`:352` = `WebFetchResult`（定义见 `:536`
 *    `{url, status, statusText, headers, content, contentLength, contentType}`）。
 *
 * 而原 schema 的字段名与出口**不一致**（`statusCode` vs 出口的 `status`；`fetchTime`/`truncated`
 * 出口根本没有）⇒ 一旦被误接到 `Tool.outputSchema` 必定每次误报。详见
 * `.trae/specs/tool-output-schema-layer-audit.md`（T4）。
 */

export type WebFetchInputType = z.infer<typeof WebFetchInputSchema>;

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
