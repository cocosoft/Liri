/**
 * FileSearchTool 入口
 *
 * 基于 Glob 的文件搜索工具，返回含 canonicalPath 的搜索结果。
 */
export { FileSearchTool } from './FileSearchTool';
export {
  FileSearchInputSchema,
  FileSearchOutputSchema,
  validateFileSearchInput,
} from './schemas';
export type { FileSearchInputType, FileSearchOutputType } from './schemas';
export type { FileSearchItem } from './FileSearchTool';
