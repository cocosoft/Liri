import { z } from 'zod';

export const BriefInputSchema = z.strictObject({
  sessionId: z
    .string()
    .optional()
    .describe('Session ID to generate summary for'),
  maxLength: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1000)
    .describe('Maximum summary length'),
  messageCount: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe('Number of recent messages to analyze'),
  summaryType: z
    .enum(['concise', 'detailed', 'actionable'])
    .optional()
    .default('concise')
    .describe('Summary type'),
});

/**
 * ⚠️ `BriefOutputSchema`（`{success, output, error?}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：该工具**手写 `ToolResult`、没有任何载荷字段** —— 成功分支
 * `{ success: true, output: <summary 字符串> }`、失败分支 `{ success: false, error }`
 * ⇒ 本 schema 描述的其实是 **`ToolResult` 本体**（success/output/error），而**校验只看载荷**
 * （`data ?? result`；`output` 是**人类可读文本**、不作载荷）⇒ **声明无意义**。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export function validateBriefInput(input: unknown) {
  const result = BriefInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
