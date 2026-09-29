import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\GlobTool\schemas');

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

/**
 * ⚠️ 本文件原有的 `GlobOutputSchema`（`{durationMs, numFiles, filenames, truncated}`）
 * 已于 2026-09-29 删除（T6 分批处置 · 批次 1）。
 *
 * 原因（实证）：它描述的是**内层 `globAsync()`** 的返回，而工具出口的 `data`
 * **只取 `filenames`**（**字符串数组**）⇒ 属**错层定义**，接上必每次误报。
 * 出口契约已**就地在工具上**声明：`tools/search/GlobTool.ts:41` = `z.array(z.string())`
 * （该文件 `:35` 另有"**刻意不复用本 schema**"的取证注释）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type GlobInputType = z.infer<typeof GlobInputSchema>;

/**
 * 验证 GlobTool 输入
 */
export function validateGlobInput(input: unknown): GlobInputType {
  const result = GlobInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Glob输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
