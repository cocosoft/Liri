/**
 * 搜索引擎站点真源（U-20 / B5-2-101，2026-10-18）。
 *
 * `WebSearchTool`（providers + 工具本体）与 `BrowserTool` 共用同一批站点字面量 ——
 * 原实现三处各自硬编码，`lint:consts` 以「同值字面量跨文件重复」上报。
 * 仅收敛**站点基址**；查询参数（`count` / `setlang` / `num` / `hl`）仍留在各自调用点。
 */
export const GOOGLE_HOME_URL = 'https://www.google.com';
export const GOOGLE_SEARCH_BASE_URL = `${GOOGLE_HOME_URL}/search`;

export const BING_HOME_URL = 'https://www.bing.com';
export const BING_SEARCH_BASE_URL = `${BING_HOME_URL}/search`;

// 2026-11-03：Bing 的 `/search` 已改为 JS 渲染（静态页零 `b_algo`），
// 主通道改用 DuckDuckGo 的无 JS HTML 端点（`result__a` / `result__snippet` 可静态解析）。
export const DUCKDUCKGO_HTML_SEARCH_BASE_URL =
  'https://html.duckduckgo.com/html';
