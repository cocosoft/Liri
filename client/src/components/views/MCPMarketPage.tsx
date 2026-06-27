import { useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { useMCPStore } from "../../stores/mcpStore";
import { useToastStore } from "../../stores/toastStore";
import type { SearchResult } from "../../services/mcpMarketplaceService";
import MCPStatsPanel from "./MCPStatsPanel";
import MCPInstalledList from "./MCPInstalledList";
import MCPConfigModal, { type MCPConfigData } from "./MCPConfigModal";
import MCPToolsPanel from "./MCPToolsPanel";
import { MCPMarketDetailModal } from "./MCPMarketDetailModal";
import ConfirmDialog from "../common/ConfirmDialog";
import { SkeletonCard } from "../common/Skeleton";

const CATEGORIES = [
  { value: "all", label: "全部" },
  { value: "official", label: "官方" },
  { value: "third_party", label: "第三方" },
];

/**
 * MCPMarketPage — MCP 服务器管理页面
 * 使用 useMCPStore 统一管理状态，包含统计面板、搜索、安装/卸载/启停
 */
function MCPMarketPage() {
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  const {
    searchResults,
    installedServers,
    isLoading,
    operatingId,
    error,
    filters,
    selectedServerDetail,
    showDetail,
    confirmUninstallId,
    configModalTarget,
    showConfigModal,
    searchMarket,
    loadInstalled,
    install,
    uninstall,
    toggleServer,
    getServerDetail,
    setFilters,
    closeDetail,
    promptUninstall,
    cancelUninstall,
    openConfigModal,
    closeConfigModal,
    verifyServer,
    verifyingServer,
    availableRegistries,
    loadRegistries,
    setSourceRegistry,
    isInstalled,
    isEnabled,
    getStats,
    page,
    pageSize,
    setPage,
  } = useMCPStore();

  const [browseActive, setBrowseActive] = useState(false);

  // 首次加载已安装列表
  useEffect(() => {
    loadInstalled();
    loadRegistries();
  }, [loadInstalled, loadRegistries]);

  // 搜索防抖
  useEffect(() => {
    if (!filters.search) {
      searchMarket(undefined, filters.registry);
      return;
    }

    const timer = setTimeout(() => {
      searchMarket(filters.search, filters.registry);
    }, 300);

    return () => clearTimeout(timer);
  }, [filters.search, filters.registry, filters.sourceRegistry, searchMarket]);

  const stats = getStats();
  const { addToast } = useToastStore();

  // ── 带 Toast 反馈的操作封装 ────────────────────────

  const handleInstall = useCallback(
    async (serverId: string) => {
      await install(serverId);
      const server = searchResults.find((r) => r.server.name === serverId);
      const label = server?.server.title || serverId;
      addToast("success", `"${label}" ${t("mcp.installSuccess")}`);
    },
    [install, searchResults, addToast],
  );

  const handleToggle = useCallback(
    async (serverId: string, enabled: boolean) => {
      await toggleServer(serverId, enabled);
      const server =
        installedServers.find((s) => s.name === serverId) ||
        searchResults.find((r) => r.server.name === serverId)?.server;
      const label = server?.title || serverId;
      addToast("info", `"${label}" ${enabled ? "已启用" : "已禁用"}`);
    },
    [toggleServer, installedServers, searchResults, addToast],
  );

  const handleUninstall = useCallback(
    async (serverId: string) => {
      await uninstall(serverId);
      const label =
        searchResults.find((r) => r.server.name === serverId)?.server.title ||
        serverId;
      addToast("success", `"${label}" 已卸载`);
    },
    [uninstall, searchResults, addToast],
  );

  // 处理搜索框输入
  const handleSearchChange = useCallback(
    (value: string) => {
      setFilters({ search: value });
      if (value) setBrowseActive(false);
    },
    [setFilters],
  );

  // ── 分页切片 ──────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(searchResults.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedResults = searchResults.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  // 处理分类切换
  const handleCategoryChange = useCallback(
    (value: string) => {
      setFilters({ registry: value as "all" | "official" | "third_party" });
    },
    [setFilters],
  );

  // 点击搜索结果行查看详情
  const handleShowDetail = useCallback(
    async (result: SearchResult) => {
      try {
        await getServerDetail(result.server.name);
      } catch {
        // 已在 store 中处理
      }
    },
    [getServerDetail],
  );

  // 注册表标签
  const getRegistryLabel = (server: SearchResult["server"]) => {
    if (server.registry === "official") return t("mcp.official");
    return server.sourceRegistry || t("mcp.thirdParty");
  };

  // 评分星级
  const getRatingStars = (rating: number) => {
    const stars = Math.round(rating);
    return "★".repeat(stars) + "☆".repeat(5 - stars);
  };

  // 状态标签
  const getStatusBadge = (name: string) => {
    if (!isInstalled(name)) return null;

    const enabled = isEnabled(name);
    return (
      <span
        className={`px-2 py-0.5 text-xs rounded-full ${
          enabled
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
        }`}
      >
        {enabled ? "已启用" : "已禁用"}
      </span>
    );
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        {/* 统计面板 */}
        <MCPStatsPanel stats={stats} />

        {/* 已安装服务器列表 */}
        <MCPInstalledList />

        {/* 工具浏览面板 */}
        <MCPToolsPanel />

        {/* 搜索栏 + 手动添加 */}
        <div className="flex items-center justify-between mb-3">
          <h2
            className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
          >
            {t("mcp.title")}
          </h2>
          <button
            onClick={() => openConfigModal(null)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              isDark
                ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
            title={t("mcp.addServer")}
          >
            + 手动添加
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div
            className={`flex-1 relative rounded-lg border ${
              isDark
                ? "bg-gray-800 border-gray-700"
                : "bg-white border-gray-300"
            }`}
          >
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索 MCP 服务器..."
              className={`w-full px-4 py-2 text-sm outline-none ${
                isDark
                  ? "bg-transparent text-white placeholder-gray-400"
                  : "bg-white text-gray-900 placeholder-gray-500"
              }`}
            />
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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

          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((category) => (
              <button
                key={category.value}
                onClick={() => handleCategoryChange(category.value)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filters.registry === category.value
                    ? "bg-blue-600 text-white"
                    : isDark
                      ? "bg-gray-800 text-gray-300 hover:bg-gray-700"
                      : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {category.value === "all"
                  ? t("common.all")
                  : category.value === "official"
                    ? t("mcp.official")
                    : t("mcp.thirdParty")}
              </button>
            ))}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── 注册表源选择器 + 浏览按钮 ── */}
        {availableRegistries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("mcp.registry")}:
            </span>
            <button
              onClick={() => setSourceRegistry("")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                !filters.sourceRegistry
                  ? isDark
                    ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                    : "bg-blue-100 text-blue-700 border border-blue-300"
                  : isDark
                    ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                    : "text-gray-600 hover:text-gray-900 border border-gray-200"
              }`}
            >
              全部
            </button>
            {availableRegistries.map((reg) => (
              <button
                key={reg.id}
                onClick={() =>
                  setSourceRegistry(
                    filters.sourceRegistry === reg.sourceRegistry
                      ? ""
                      : reg.sourceRegistry,
                  )
                }
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filters.sourceRegistry === reg.sourceRegistry
                    ? isDark
                      ? "bg-blue-900/50 text-blue-300 border border-blue-600"
                      : "bg-blue-100 text-blue-700 border border-blue-300"
                    : isDark
                      ? "text-gray-400 hover:text-gray-200 border border-gray-700"
                      : "text-gray-600 hover:text-gray-900 border border-gray-200"
                }`}
              >
                {reg.name}
              </button>
            ))}
            <button
              onClick={() => {
                setBrowseActive(true);
                searchMarket("", filters.registry);
              }}
              disabled={isLoading}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isLoading
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                  : isDark
                    ? "bg-green-900/30 text-green-400 hover:bg-green-800/30 border border-green-600/30"
                    : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
              }`}
            >
              {isLoading ? t("common.loading") : t("mcp.browseMarket")}
            </button>
          </div>
        )}

        {/* 搜索结果区域 */}
        <div
          className={`rounded-lg border ${
            isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
          }`}
        >
          {isLoading ? (
            <div className="p-6 space-y-3">
              <SkeletonCard count={3} />
            </div>
          ) : !filters.search && !browseActive ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">🔌</div>
              <p
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("mcp.selectRegistryHint")}
              </p>
              <p
                className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                {t("mcp.installedCount", { count: stats.total })}
              </p>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              未找到匹配的 MCP 服务器
            </div>
          ) : (
            <>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedResults.map((result) => (
                  <div
                    key={`${result.server.registry}:${result.server.name}`}
                    className="px-4 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    onClick={() => handleShowDetail(result)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            isDark ? "bg-gray-700" : "bg-gray-100"
                          }`}
                        >
                          <svg
                            className="w-5 h-5 text-gray-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </div>
                        <div>
                          <h4
                            className={`font-medium ${
                              isDark ? "text-gray-100" : "text-gray-900"
                            }`}
                          >
                            {result.server.title}
                          </h4>
                          <p
                            className={`text-sm ${
                              isDark ? "text-gray-400" : "text-gray-500"
                            }`}
                          >
                            {result.server.description}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 ml-13 flex items-center gap-4">
                        <span
                          className={`text-xs ${
                            isDark ? "text-gray-500" : "text-gray-400"
                          }`}
                        >
                          {getRegistryLabel(result.server)}
                        </span>
                        <span
                          className={`text-xs ${
                            isDark ? "text-gray-500" : "text-gray-400"
                          }`}
                        >
                          {t("mcp.author")}: {result.server.author}
                        </span>
                        <span
                          className={`text-xs ${
                            isDark ? "text-gray-500" : "text-gray-400"
                          }`}
                        >
                          {getRatingStars(result.server.rating)}
                        </span>
                        <span
                          className={`text-xs ${
                            isDark ? "text-gray-500" : "text-gray-400"
                          }`}
                        >
                          安装: {result.server.installCount}
                        </span>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-3 ml-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {getStatusBadge(result.server.name)}
                      {isInstalled(result.server.name) ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              handleToggle(
                                result.server.name,
                                !isEnabled(result.server.name),
                              )
                            }
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                              isEnabled(result.server.name)
                                ? "bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                                : "bg-blue-600 hover:bg-blue-700 text-white"
                            }`}
                          >
                            {isEnabled(result.server.name) ? "禁用" : "启用"}
                          </button>
                          <button
                            onClick={() => promptUninstall(result.server.name)}
                            className="px-3 py-1.5 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors"
                          >
                            卸载
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleInstall(result.server.name)}
                          disabled={operatingId === result.server.name}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            operatingId === result.server.name
                              ? "bg-blue-400 text-white cursor-not-allowed"
                              : "bg-blue-600 hover:bg-blue-700 text-white"
                          }`}
                        >
                          {operatingId === result.server.name
                            ? t("common.installing")
                            : t("common.install")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* 分页控件 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {t("common.prevPage")}
                  </button>
                  <span
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {safePage} / {totalPages} （共 {searchResults.length} 项）
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {t("common.nextPage")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {/* 详情弹窗 */}
        {showDetail && selectedServerDetail && (
          <MCPMarketDetailModal
            server={selectedServerDetail}
            isInstalled={isInstalled(selectedServerDetail.name)}
            isEnabled={isEnabled(selectedServerDetail.name)}
            installing={operatingId === selectedServerDetail.name}
            onClose={closeDetail}
            onInstall={() => handleInstall(selectedServerDetail.name)}
            onUninstall={() => {
              closeDetail();
              promptUninstall(selectedServerDetail.name);
            }}
            onToggle={(enabled) =>
              handleToggle(selectedServerDetail.name, enabled)
            }
          />
        )}

        {/* 卸载确认 */}
        <ConfirmDialog
          open={!!confirmUninstallId}
          title="确认卸载"
          message="确定要卸载这个 MCP 服务器吗？卸载后将无法使用该服务器提供的工具。"
          confirmText="卸载"
          variant="danger"
          onConfirm={() => {
            if (confirmUninstallId) {
              handleUninstall(confirmUninstallId);
            }
          }}
          onCancel={cancelUninstall}
        />

        {/* 配置编辑弹窗 */}
        <MCPConfigModal
          server={configModalTarget}
          show={showConfigModal}
          onClose={closeConfigModal}
          onSave={(_data: MCPConfigData) => {
            closeConfigModal();
            loadInstalled();
          }}
          onExport={() => {}}
          onVerify={
            configModalTarget
              ? () => verifyServer(configModalTarget.name)
              : undefined
          }
          verifying={
            configModalTarget
              ? verifyingServer === configModalTarget.name
              : false
          }
        />
      </div>
    </div>
  );
}

export default MCPMarketPage;
