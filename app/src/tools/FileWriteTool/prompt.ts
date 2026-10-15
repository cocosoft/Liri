/**
 * 工具名常量（2026-09-26 修正）：原值 `'write'` 与本仓**真实注册名** `file_write` 不符
 * ⇒ 该常量经 `tools/index.ts` 对外导出，任何用它做"是否写文件"判定的消费方都会**恒不成立**
 * （与 `constants/tools.ts` 的 `file_*` 是同一类缺陷）。守卫见 `tests/tools/toolNameLists.test.ts`。
 */
// 硬编码治理 B5-2㉙：**单一真源**在 `@modules/constants`（含 `satisfies ToolName` 类型约束）；
// 本文件仅**转发导出** ⇒ 保留既有消费面（`tools/index.ts` barrel 与 `toolNameLists.test.ts` 的同值契约）
export { FILE_WRITE_TOOL_NAME } from '@modules/constants';

export function getWriteToolDescription(): string {
  return `Writes a file to the local filesystem.
Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the read tool first to read the file's contents.
- ALWAYS prefer editing existing files using edit tool in the codebase. NEVER write new files unless explicitly required.`;
}
