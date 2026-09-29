import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\FileEditTool\schemas');

/**
 * FileEditTool 输入模式
 */
export const FileEditInputSchema = z.strictObject({
  filePath: z.string().min(1, '文件路径不能为空').describe('要编辑的文件路径'),
  oldString: z
    .string()
    .min(1, '旧字符串不能为空')
    .describe('需要被替换的旧字符串'),
  newString: z.string().describe('替换后的新字符串'),
});

export type FileEditInputType = z.infer<typeof FileEditInputSchema>;

/**
 * ⚠️ `FileEditOutputSchema`（`{filePath, linesChanged, replaced, oldStringFound}`）已于 2026-09-29 删除（T6 分批处置 · 批次 3）。
 *
 * 原因（实证）：该工具出口 `data` **两种形态混杂**且**与 schema 都不符** ——
 *  ① **字符串**（4 处：freshness 报错、`old_string is required`、old==new、外层 error msg）；
 *  ② **对象**，但只有两种、且**一种字段不全**：`{filePath, replaced}`（缺 `linesChanged`/
 *     `oldStringFound` 这两个**必填**字段 ⇒ 接上必误报）与 `{filePath, linesChanged, replaced,
 *     oldStringFound, replaceAll}`（多出的 `replaceAll` 会被 zod 默认 strip，无害）。
 * ⇒ 属**错层/不完整定义**。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

/**
 * 验证 FileEditTool 输入
 */
export function validateFileEditInput(input: unknown): FileEditInputType {
  const result = FileEditInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileEdit输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
