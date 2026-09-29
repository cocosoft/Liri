import { z } from 'zod';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\FileWriteTool\schemas');

/**
 * FileWriteTool 输入模式
 */
export const FileWriteInputSchema = z.strictObject({
  filePath: z.string().min(1, '文件路径不能为空').describe('要写入的文件路径'),
  content: z.string().describe('文件内容'),
});

/**
 * ⚠️ 本文件原有的 `FileWriteOutputSchema`（`{type: 'create'|'update', filePath, sizeBytes, linesWritten}`）
 * 已于 2026-09-29 删除（T6 分批处置 · 批次 1）。
 *
 * 原因（实证）：它描述的是**写入结果的元信息对象**，而该工具**出口的 `data` 恒为字符串**
 * （6 处 `createToolResult` 全传字符串：`FileWriteTool.ts:194/223/238/253/300/325`，
 * 如 `'File written successfully: …'`、`'source_file 指定的文件不存在: …'`）
 * ⇒ 属**错层定义**，接上必每次误报。**出口恒为字符串（6/6 处已核）**；该工具目前**未声明** `outputSchema`,
 * 是否为其**新写** `z.string()` 属"top-N 扩展"议题，**不在本批范围**（本批只裁定存量错层定义）。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type FileWriteInputType = z.infer<typeof FileWriteInputSchema>;

/**
 * 验证 FileWriteTool 输入
 */
export function validateFileWriteInput(input: unknown): FileWriteInputType {
  const result = FileWriteInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `FileWrite输入验证失败: ${errors}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  return result.data;
}
