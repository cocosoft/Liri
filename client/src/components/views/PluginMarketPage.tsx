import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { usePluginStore } from "../../stores/pluginStore";
import { useToastStore } from "../../stores/toastStore";
import type { MarketplacePlugin } from "../../services/pluginMarketplaceService";
import ConfirmDialog from "../common/ConfirmDialog";

/**
 * PluginMarketPage — Liri 应用插件市场页面
 * 浏览/搜索市场插件，管理已安装插件（安装/卸载/详情）
 * 2026-08-06 新增（J-13）：服务对象为 Liri 应用插件，与 MCP 市场页面（MCPMarketPage）不同
 */
function PluginMarketPage() {
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  const {
    searchResults,
    total,
    installedPlugins,
    pendingPlugins,
    isLoading,
    operatingId,
    error,
    selectedPlugin,
    showDetail,
    confirmUninstallId,
    query,
    searchMarket,
    loadInstalled,
    loadPending,
    install,
    uninstall,
    getPluginDetail,
    setQuery,
    clearError,
    closeDetail,
    promptUninstall,
    cancelUninstall,
    isInstalled,
  } = usePluginStore();
  const { addToast } = useToastStore();

  // 首次加载已安装列表 + 响应式挂起插件
  useEffect(() => {
    loadInstalled();
    loadPending();
  }, [loadInstalled, loadPending]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => {
      searchMarket(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchMarket]);

  const handleInstall = useCallback(
    async (plugin: MarketplacePlugin) => {
      await install(plugin.name || plugin.id);
      addToast("success", `"${plugin.name}" 已安装`);
    },
    [install, addToast],
  );

  const handleUninstall = useCallback(
    async (pluginId: string) => {
      await uninstall(pluginId);
      addToast("success", `"${pluginId}" 已卸载`);
    },
    [uninstall, addToast],
  );

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        {/* 页面标题 */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("pluginMarket.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("pluginMarket.desc")}
          </p>
        </div>

        {/* 已安装插件列表 */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
              {t("pluginMarket.installed")} ({installedPlugins.length})
            </h2>
          </div>
          {installedPlugins.length === 0 ? (
            <div
              className={`p-4 rounded-lg text-sm ${
                isDark
                  ? "bg-gray-800 text-gray-400 border border-gray-700"
                  : "bg-white text-gray-500 border border-gray-200"
              }`}
            >
              {t("pluginMarket.noInstalled")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {installedPlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className={`p-4 rounded-lg border ${
                    isDark
                      ? "bg-gray-800 border-gray-700"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {plugin.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        v{plugin.version} · {plugin.author || "Unknown"}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        plugin.enabled
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                      }`}
                    >
                      {plugin.enabled ? "已启用" : "已禁用"}
                    </span>
                  </div>
                  {plugin.description && (
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                      {plugin.description}
                    </p>
                  )}
                  <button
                    onClick={() => promptUninstall(plugin.name)}
                    className={`mt-3 text-xs px-2.5 py-1 rounded-md transition-colors ${
                      isDark
                        ? "text-red-400 hover:bg-red-900/30"
                        : "text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {t("pluginMarket.uninstall")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 响应式挂起插件（inject 必需服务缺失等待中，4.4） */}
        {pendingPlugins.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                响应式挂起 ({pendingPlugins.length})
              </h2>
              <button
                onClick={loadPending}
                className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                刷新
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pendingPlugins.map((plugin) => (
                <div
                  key={plugin.pluginId}
                  className={`p-4 rounded-lg border ${
                    isDark
                      ? "bg-amber-900/10 border-amber-800"
                      : "bg-amber-50 border-amber-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {plugin.pluginName}
                        {plugin.timedOut && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            已超时
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        v· 等待服务注册
                      </div>
                    </div>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      pending
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    缺失必需注入服务：
                    <span className="font-mono text-xs">
                      {plugin.missing.join(", ")}
                    </span>
                  </p>
                  {plugin.timedOut && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      挂起超时（可能服务级依赖死锁），请安装提供者插件后刷新
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 搜索栏 */}
        <div className="mb-4">
          <div
            className={`relative rounded-lg border ${
              isDark
                ? "bg-gray-800 border-gray-700"
                : "bg-white border-gray-300"
            }`}
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pluginMarket.searchPlaceholder")}
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
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {error}
            <button onClick={clearError} className="float-right">
              ✕
            </button>
          </div>
        )}

        {/* 搜索结果 */}
        {isLoading ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            {t("common.loading")}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {t("pluginMarket.resultCount", { count: total })}
            </div>
            {searchResults.length === 0 && (
              <div
                className={`p-4 rounded-lg text-sm ${
                  isDark
                    ? "bg-gray-800 text-gray-400 border border-gray-700"
                    : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {t("pluginMarket.noResults")}
              </div>
            )}
            {searchResults.map((plugin) => {
              const installed = isInstalled(plugin.name || plugin.id);
              return (
                <div
                  key={plugin.id}
                  className={`p-4 rounded-lg border ${
                    isDark
                      ? "bg-gray-800 border-gray-700"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <button
                      onClick={() => getPluginDetail(plugin.id)}
                      className="text-left flex-1"
                    >
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {plugin.name}
                        {plugin.tags?.includes("official") && (
                          <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            官方
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {plugin.author} · v{plugin.version}
                      </div>
                      {plugin.description && (
                        <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                          {plugin.description}
                        </p>
                      )}
                    </button>
                    <button
                      onClick={() =>
                        installed
                          ? promptUninstall(plugin.name || plugin.id)
                          : handleInstall(plugin)
                      }
                      disabled={operatingId === plugin.name}
                      className={`ml-3 shrink-0 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        operatingId === plugin.name
                          ? "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                          : installed
                            ? isDark
                              ? "text-red-400 hover:bg-red-900/30 border border-red-800/50"
                              : "text-red-600 hover:bg-red-50 border border-red-200"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      {operatingId === plugin.name
                        ? t("common.loading")
                        : installed
                          ? t("pluginMarket.uninstall")
                          : t("pluginMarket.install")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 详情弹窗 */}
        {showDetail && selectedPlugin && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={closeDetail}
          >
            <div
              className={`w-full max-w-md rounded-xl p-6 ${
                isDark ? "bg-gray-800" : "bg-white"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {selectedPlugin.name}
                  </h3>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    v{selectedPlugin.version} · {selectedPlugin.author}
                  </div>
                </div>
                <button
                  onClick={closeDetail}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
              {selectedPlugin.description && (
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                  {selectedPlugin.description}
                </p>
              )}
              <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                {selectedPlugin.license && (
                  <div>许可证: {selectedPlugin.license}</div>
                )}
                {selectedPlugin.repository && (
                  <div>
                    仓库:{" "}
                    <a
                      href={selectedPlugin.repository}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      {selectedPlugin.repository}
                    </a>
                  </div>
                )}
                {selectedPlugin.tags && selectedPlugin.tags.length > 0 && (
                  <div>标签: {selectedPlugin.tags.join(", ")}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 卸载确认 */}
        <ConfirmDialog
          open={!!confirmUninstallId}
          title={t("pluginMarket.confirmUninstallTitle")}
          message={t("pluginMarket.confirmUninstallMsg")}
          confirmText={t("pluginMarket.uninstall")}
          variant="danger"
          onConfirm={() => {
            if (confirmUninstallId) {
              handleUninstall(confirmUninstallId);
            }
          }}
          onCancel={cancelUninstall}
        />
      </div>
    </div>
  );
}

export default PluginMarketPage;
