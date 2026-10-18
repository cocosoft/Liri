/**
 * FileEdit工具提示模板
 */

// 硬编码治理 B5-2㉙：**单一真源**在 `@modules/constants`（含 `satisfies ToolName` 类型约束）；
// 本文件仅**转发导出** ⇒ 保留既有消费面（`tools/index.ts` barrel 与 `toolNameLists.test.ts` 的同值契约）
export { FILE_EDIT_TOOL_NAME } from '@modules/constants';

export function getEditToolDescription(): string {
  return 'Edit file content using SearchReplace pattern';
}
