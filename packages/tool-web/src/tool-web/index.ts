/**
 * `@openliri/tool-web` 包出口（J 档，2026-11-23）
 *
 * 域：Web / 检索（web_fetch + web_search + 可插拔 WebToolProvider）。
 * - 根出口：app 注册表与既有公共面所需符号；
 * - 深层子路径（`@openliri/tool-web/WebFetchTool/*`）由 `package.json#exports["./*"]`
 *   与 `app/tsconfig.json` paths 支持，供 app/tests 的细化断言使用。
 */

export { WebFetchTool, createWebFetchTool } from './WebFetchTool/WebFetchTool';
export {
  WebSearchTool,
  createWebSearchTool,
} from './WebSearchTool/WebSearchTool';
export { checkSsrf, describeSsrfBlock } from './WebFetchTool/ssrf';
export type { SearchResult } from './WebSearchTool/providers';

// 既有公共面：`app/src/tools/index.ts` 历史上 `export * from './web'`
export * from './web';
