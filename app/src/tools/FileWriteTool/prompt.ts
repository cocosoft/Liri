/**
 * 工具名常量（2026-09-26 修正）：原值 `'write'` 与本仓**真实注册名** `file_write` 不符
 * ⇒ 该常量经 `tools/index.ts` 对外导出，任何用它做"是否写文件"判定的消费方都会**恒不成立**
 * （与 `constants/tools.ts` 的 `file_*` 是同一类缺陷）。守卫见 `tests/tools/toolNameLists.test.ts`。
 */
export const FILE_WRITE_TOOL_NAME = 'file_write';

export function getWriteToolDescription(): string {
  return `Writes a file to the local filesystem.
Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the read tool first to read the file's contents.
- ALWAYS prefer editing existing files using edit tool in the codebase. NEVER write new files unless explicitly required.`;
}
