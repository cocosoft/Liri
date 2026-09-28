import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\WebSearchTool\schemas');

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

/**
 * ⚠️ 本文件原有的 `WebSearchOutputSchema` 已于 2026-09-28 删除（T4）。
 *
 * 原因（实证）：该工具出口有三种形态，且**均未标 `success: false`** ⇒ 全部会进入
 * `ToolExecutor` 的出参校验，单一 schema 无法表达：
 *  - **错误分支**（字符串）：`WebSearchTool.ts:154/212/323/342/357/385`；
 *  - **空结果分支**（另一种对象）：`:242` = `{query, results: [], totalResults, message}`；
 *  - **成功分支**（成功对象）：`:285` = `WebSearchResult`
 *    `{query, results, totalResults, searchUrl, safeSearch}`（定义见 `:561`）。
 *
 * 而原 schema 的字段（`searchTime`）与上述**全都不一致** ⇒ 一旦被误接到
 * `Tool.outputSchema` 必定每次误报。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T4）。
 */

export type WebSearchInputType = z.infer<typeof WebSearchInputSchema>;

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
