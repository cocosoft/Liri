import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useMCPStore } from "../../stores/mcpStore";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 40];

/**
 * 从 inputSchema 中提取可读的 schema 摘要文本
 */
function formatSchema(schema: Record<string, unknown> | undefined): string {
  if (!schema || typeof schema !== "object") return "";

  const props = (schema as Record<string, unknown>).properties as
    Record<string, unknown> | undefined;
  const required = Array.isArray((schema as Record<string, unknown>).required)
    ? ((schema as Record<string, unknown>).required as string[])
    : [];

  if (!props || typeof props !== "object") return "";

  return Object.entries(props)
    .map(([key, val]) => {
      const prop = val as Record<string, unknown>;
      const type = prop.type || "any";
      const req = required.includes(key) ? "*" : "";
      const desc = prop.description ? ` — ${prop.description}` : "";
      return `${req}${key}: ${type}${desc}`;
    })
    .join("\n");
}

/**
 * MCPToolsPanel — 工具浏览面板
 * 使用 store 中的 allTools 数据，支持搜索/分页/Schema展开/工具启停
 */
function MCPToolsPanel() {
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  const {
    allTools,
    toolsLoading,
    toolSearch,
    installedServers,
    loadAllTools,
    toggleTool,
    setToolSearch,
  } = useMCPStore();

  // 首次加载时拉取工具列表
  useEffect(() => {
    if (installedServers.length > 0) {
      loadAllTools();
    }
  }, [installedServers.length, loadAllTools]);

  // 搜索过滤
  const filteredTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    if (!q)
      return allTools.map((t) => ({
        ...t,
        schema: formatSchema(t.inputSchema),
      }));

    return allTools
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.server.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      )
      .map((t) => ({ ...t, schema: formatSchema(t.inputSchema) }));
  }, [allTools, toolSearch]);

  // 分页状态
  const pageSizeOptions = PAGE_SIZE_OPTIONS;
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(filteredTools.length / pageSize));
  const pagedTools = filteredTools.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  const handleSearch = useCallback(
    (value: string) => {
      setToolSearch(value);
      setPage(1);
    },
    [setToolSearch],
  );

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  // 空状态
  if (installedServers.length === 0) {
    return (
      <div
        className={`rounded-lg border p-6 mb-6 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <h2
          className={`text-lg font-semibold mb-3 ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          MCP 工具
        </h2>
        <div className="text-center py-6">
          <div className="text-3xl mb-2">🔧</div>
          <p
            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            安装 MCP 服务器后，这里将展示所有可用工具
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border mb-6 ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
    >
      {/* 标题栏 */}
      <div
        className={`px-4 py-3 flex items-center justify-between border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <div className="flex items-center gap-2">
          <h2
            className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            MCP 工具
          </h2>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
          >
            {allTools.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            每页
          </span>
          <select
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            className={`text-xs bg-transparent outline-none border rounded px-1 py-0.5 ${
              isDark
                ? "border-gray-600 text-gray-300"
                : "border-gray-300 text-gray-600"
            }`}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 搜索框 */}
      <div
        className={`px-4 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <div className="relative">
          <input
            type="search"
            value={toolSearch}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索工具（按名称、服务器、描述）..."
            className={`w-full text-sm bg-transparent outline-none border rounded px-3 py-1.5 pl-8 ${
              isDark
                ? "border-gray-600 text-white placeholder-gray-500 focus:border-blue-400"
                : "border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"
            }`}
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* 工具列表 */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {toolsLoading ? (
          <div className="p-6 text-center text-sm text-gray-400">
            {t("common.loading")}
          </div>
        ) : filteredTools.length === 0 ? (
          <div className="p-6 text-center">
            <p
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {allTools.length === 0
                ? t("mcp.loadingTools")
                : t("mcp.noMatchTools")}
            </p>
          </div>
        ) : (
          pagedTools.map((tool) => {
            const key = `${tool.server}:${tool.name}`;
            const isExpanded = expandedKey === key;

            return (
              <div key={key} className="px-4 py-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`font-medium text-sm font-mono ${isDark ? "text-blue-400" : "text-blue-600"}`}
                      >
                        {tool.name}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}
                      >
                        {tool.server}
                      </span>
                      {/* 启用/禁用开关 */}
                      <button
                        onClick={() =>
                          toggleTool(tool.name, tool.server, !tool.enabled)
                        }
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          tool.enabled
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                        }`}
                      >
                        {tool.enabled ? "已启用" : "已禁用"}
                      </button>
                    </div>
                    {tool.description && (
                      <p
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {tool.description}
                      </p>
                    )}
                  </div>

                  {tool.schema && (
                    <button
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                      className={`ml-3 px-2 py-1 text-xs rounded transition-colors ${
                        isDark
                          ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                          : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                      }`}
                    >
                      {isExpanded ? t("mcp.collapse") : t("mcp.schema")}
                    </button>
                  )}
                </div>

                {isExpanded && tool.schema && (
                  <pre
                    className={`mt-2 p-2 rounded text-xs font-mono overflow-x-auto ${
                      isDark
                        ? "bg-gray-900 text-gray-300"
                        : "bg-gray-50 text-gray-700"
                    }`}
                  >
                    {tool.schema}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 分页器 */}
      {totalPages > 1 && (
        <div
          className={`px-4 py-2 flex items-center justify-between border-t ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            {filteredTools.length} 个工具 · 第 {page}/{totalPages} 页
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                isDark
                  ? "bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-40"
              }`}
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                isDark
                  ? "bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-40"
              }`}
            >
              {t("common.nextPage")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MCPToolsPanel;
