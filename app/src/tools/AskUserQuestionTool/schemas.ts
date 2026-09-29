import { z } from 'zod';

/**
 * AskUserQuestionTool 输入模式
 */
export const AskUserQuestionInputSchema = z.strictObject({
  question: z.string().min(1).max(500).describe('向用户提出的问题'),
  header: z
    .string()
    .min(1)
    .max(30)
    .describe('简短标签/标题（如 "Auth method", "Library"），显示为标签样式'),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(100).describe('选项显示文本'),
        description: z.string().min(1).max(300).describe('选项说明/解释'),
      })
    )
    .min(2)
    .max(4)
    .describe('选项列表（2-4 个选项），用户可选择其中一个或多个'),
  multiSelect: z.boolean().optional().describe('是否允许多选，默认为 false'),
});

/**
 * ⚠️ `AskUserQuestionOutputSchema`（`{questionId, question, answers[], timestamp}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：该工具**仅两处出口且都不符** ——
 * ① `{ error, retryable: false }`（对象字面量，**未在 ToolResult 层标 `success:false`** ⇒ 会被校验）；
 * ② `JSON.stringify(result, null, 2)`（**字符串**；`result` 为 `AskUserQuestionResult`，
 * 比 schema **多一个 `questionType`**）。
 * ⇒ 与 schema 的 4 个必填字段**都不符**。详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export type AskUserQuestionInput = z.infer<typeof AskUserQuestionInputSchema>;

/**
 * 验证 AskUserQuestionTool 输入
 */
export function validateAskUserQuestionInput(input: unknown) {
  const result = AskUserQuestionInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `AskUserQuestionTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
