import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\FileReadTool\schemas');

/**
 * FileReadTool 输入模式
 */
export const FileReadInputSchema = z.strictObject({
  filePath: z.string().min(1, '文件路径不能为空').describe('要读取的文件路径'),
  offset: z.number().int().positive().optional().describe('起始行号，从1开始'),
  limit: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('最大读取行数'),
});

/**
 * ⚠️ 本文件原有的 `FileReadOutputSchema`（`{content, filePath, totalLines, lineCount, offset, sizeBytes, truncated}`）
 * 已于 2026-09-29 删除（T6 分批处置 · 批次 1）。
 *
 * 原因（实证）：它描述的是**内层读取结果的元信息对象**，而该工具**出口的 `data` 是字符串**
 * （正文 / Markdown / 错误说明走**同一通道**）⇒ 属**错层定义**，接上必每次误报。
 * 出口契约已**就地在工具上**声明：`FileReadTool.ts:253` = `z.string()`（刻意不断言非空）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type FileReadInputType = z.infer<typeof FileReadInputSchema>;

/**
 * 验证 FileReadTool 输入
 */
export function validateFileReadInput(input: unknown): FileReadInputType {
  const result = FileReadInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileRead输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
