import { z } from 'zod';

export const SkillInputSchema = z.strictObject({
  name: z.string().min(1).describe('The name of the skill to execute'),
  arguments: z
    .record(z.unknown())
    .optional()
    .describe('Arguments to pass to the skill'),
});

/**
 * ⚠️ `SkillOutputSchema` 已于 2026-09-29 删除（T6 分批处置 · 批次 2；**同日按新证据更正了理由**）。
 *
 * 原因（实证）：该工具**手工构造 `ToolResult`、载荷放在 `result`**。
 * ⚠️ **"没有 `data`"不再是失效理由** —— 同日给校验器补上了「载荷缺省**回退 `result`**」
 * （`voice_input` / `voice_output` 正因此得以**接线**）。本 schema 失效的真实原因是**载荷形态不符**：
 * 出口的 `result` 是**字符串**（`SkillTool.ts` 的 `result: result`，同处 `output: result`
 * 而 `ToolResult.output?: string` ⇒ **编译期即强制**其为 string），而本 schema 描述的是**对象**
 * `{name, result?, success, error?, executionTime}` ⇒ 接上必每次误报。失败分支 `result: null`
 * ⇒ 命中「无载荷不校验」。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export function validateSkillInput(input: unknown) {
  const result = SkillInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
