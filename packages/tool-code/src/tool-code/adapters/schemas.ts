// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-03（2026-11-23）：`lsp` / `repl` 适配器的**模型可见出参结构**（JSON Schema）。
 *
 * 两个适配器都返回完整 `ToolResult`（`{success, data?, output, error?}`），
 * 而模型看到的是 `data`（`ToolUtils.formatResult()` 只序列化 `data`）⇒ 这里的 schema
 * 描述的是各 action 分支下 `data` 的字段并集，不放 `required`（分支互斥，见 `notebook` 先例）。
 */

/**
 * `lsp`：`data` 为**语言服务器原始结果**，结构随 action 变化
 * （`definition`/`references`/`completions`/`diagnostics`/`format`/`documentSymbol` 等为数组；
 * `hover`/`rename`/`codeAction` 为对象；失败分支无 `data`）。
 *
 * ⚠️ `ToolSchema.output_schema` 只支持**单一顶层类型**，无法表达"数组或对象"的联合 ⇒
 * 顶层按对象声明，数组形态在 `description` 中如实说明（不虚构字段）。
 */
export const LSP_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description:
    'LSP 原始结果（结构随 action 变化）：definition/references/completions/diagnostics/' +
    'format/documentSymbol 等为数组；hover/rename/codeAction 为对象；失败分支无 data',
  properties: {},
};

/**
 * `repl`：`data` 按 action 分支变化
 * - `start` ⇒ `{sessionId, language}`
 * - `execute` ⇒ `REPLResult`（`{success, output, error?, executionTime, exitCode?}`）
 * - `languages` ⇒ `{languages}`
 * - `stop` / 失败分支 ⇒ 无 `data`
 */
export const REPL_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description:
    'REPL 的 data 随 action 变化：start 给 sessionId/language；execute 给执行结果；' +
    'languages 给支持语言列表；stop 与失败分支无 data',
  properties: {
    sessionId: { type: 'string', description: 'REPL 会话 ID（start）' },
    language: { type: 'string', description: '编程语言（start）' },
    success: { type: 'boolean', description: '代码执行是否成功（execute）' },
    output: { type: 'string', description: '代码执行输出（execute）' },
    error: { type: 'string', description: '执行失败原因（execute）' },
    executionTime: { type: 'number', description: '执行耗时（毫秒，execute）' },
    exitCode: { type: 'number', description: '退出码（execute，可获取时）' },
    languages: {
      type: 'array',
      items: { type: 'string' },
      description: '支持的语言列表（languages）',
    },
  },
};
