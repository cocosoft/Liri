import { z } from 'zod';

export const ConfigInputSchema = z.strictObject({
  action: z
    .enum(['get', 'set', 'delete', 'list'])
    .describe('Configuration action'),
  key: z.string().optional().describe('Configuration key'),
  value: z
    .unknown()
    .optional()
    .describe('Configuration value (for set action)'),
});

/**
 * ⚠️ `ConfigOutputSchema`（`{success, output?, error?}`）已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证）：该工具**手写 `ToolResult`、没有任何载荷字段**（`data`/`result` 皆无）—— 结果一律走
 * **`output`**（字符串或 `JSON.stringify` 文本，如 `` `Set ${key} = ${value}` ``、`JSON.stringify(allConfig)``）
 * 或 `error`。⇒ 本 schema 描述的是 **`ToolResult` 本体**，而**校验只看载荷**（`data ?? result`；`output` 是
 * **人类可读文本**、不作载荷）⇒ **声明无意义**。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export function validateConfigInput(input: unknown) {
  const result = ConfigInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
