import { z } from 'zod';

export const LSPInputSchema = z.strictObject({
  operation: z
    .enum([
      'definition',
      'references',
      'hover',
      'callHierarchy',
      'symbolSearch',
    ])
    .describe('LSP operation type'),
  symbol: z.string().min(1).describe('Symbol name to query'),
  file_path: z.string().optional().describe('File path containing the symbol'),
});

/**
 * ⚠️ `LSPOutputSchema`（`{symbolName?, symbolKind?, filePath?, references?[], definition?, result?}`）
 * 已于 2026-09-29 删除（T6 分批处置 · 批次 4b）。
 *
 * 原因（实证，**错层**）：工具出口是 `data = result`，而 `result` 由 `this.lspTool.getXxx(...)` 赋值
 * （`adapters/LSPToolAdapter.ts` 的各 action 分支），按接口 `lsp/types/LSPTool.ts:31-54` 的声明其返回为
 * **`CompletionItem[]` / `Location[]` / `Diagnostic[]` / `string`**（`formatDocument` 返回字符串）
 * ⇒ 即**数组或字符串**；而本 schema 描述的是"**归一化后的对象**"（`references[].file/line/column/text`
 * 等）⇒ **不是同一层** ⇒ 接上必每次误报。
 * 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T6 分类结果）。
 */

export function validateLSPInput(input: unknown) {
  const result = LSPInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return { success: false as const, error: `验证失败: ${issues.join('; ')}` };
  }
  return { success: true as const, data: result.data };
}
