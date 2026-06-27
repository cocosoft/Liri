import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import type { ServerDetail } from "../../services/mcpMarketplaceService";

interface MCPMarketDetailModalProps {
  server: ServerDetail;
  isInstalled: boolean;
  isEnabled: boolean;
  installing: boolean;
  onClose: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: (enabled: boolean) => void;
}

export function MCPMarketDetailModal({
  server,
  isInstalled,
  isEnabled,
  installing,
  onClose,
  onInstall,
  onUninstall,
  onToggle,
}: MCPMarketDetailModalProps) {
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const getRegistryLabel = () => {
    if (server.registry === "official") return t("mcp.officialRegistry");
    return server.sourceRegistry || t("mcp.thirdParty");
  };

  const getRatingStars = (rating: number) => {
    const stars = Math.round(rating);
    return "★".repeat(stars) + "☆".repeat(5 - stars);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`relative w-full max-w-lg mx-4 rounded-lg shadow-xl border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
      >
        <div
          className={`px-6 py-4 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          <div className="flex items-center justify-between">
            <h2
              className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {server.title}
            </h2>
            <button
              onClick={onClose}
              className={`p-1 rounded-lg transition-colors ${
                isDark
                  ? "hover:bg-gray-700 text-gray-400"
                  : "hover:bg-gray-100 text-gray-500"
              }`}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p
            className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
          >
            {server.description || t("mcp.noDescription")}
          </p>

          <div
            className={`grid grid-cols-2 gap-3 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            <div>
              <span className="font-semibold">来源</span>
              <p className={isDark ? "text-gray-200" : "text-gray-800"}>
                {getRegistryLabel()}
              </p>
            </div>
            <div>
              <span className="font-semibold">{t("common.author")}</span>
              <p className={isDark ? "text-gray-200" : "text-gray-800"}>
                {server.author}
              </p>
            </div>
            <div>
              <span className="font-semibold">{t("mcp.rating")}</span>
              <p className={isDark ? "text-gray-200" : "text-gray-800"}>
                {getRatingStars(server.rating)} ({t("mcp.installCount", { count: server.installCount })})
              </p>
            </div>
            <div>
              <span className="font-semibold">{t("mcp.protocolVersion")}</span>
              <p className={isDark ? "text-gray-200" : "text-gray-800"}>
                {server.protocolVersion}
              </p>
            </div>
            {server.license && (
              <div>
                <span className="font-semibold">许可</span>
                <p className={isDark ? "text-gray-200" : "text-gray-800"}>
                  {server.license}
                </p>
              </div>
            )}
            <div>
              <span className="font-semibold">安装方式</span>
              <p className={isDark ? "text-gray-200" : "text-gray-800"}>
                {server.installTypes.join(", ")}
              </p>
            </div>
          </div>

          {server.categories.length > 0 && (
            <div>
              <span
                className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                分类
              </span>
              <div className="flex flex-wrap gap-2 mt-1">
                {server.categories.map((cat) => (
                  <span
                    key={cat}
                    className={`px-2 py-0.5 text-xs rounded-full ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {server.tools.length > 0 && (
            <div>
              <span
                className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {t("mcp.providedTools")}
              </span>
              <div className="mt-1 space-y-2">
                {server.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className={`p-2 rounded text-sm ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
                  >
                    <span
                      className={`font-medium ${isDark ? "text-blue-400" : "text-blue-600"}`}
                    >
                      {tool.name}
                    </span>
                    <p
                      className={`text-xs mt-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {tool.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {server.requiredEnv.length > 0 && (
            <div>
              <span
                className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                环境变量
              </span>
              <div className="mt-1 space-y-1">
                {server.requiredEnv.map((env) => (
                  <div
                    key={env.name}
                    className="flex items-center gap-2 text-sm"
                  >
                    <code
                      className={`px-1.5 py-0.5 rounded text-xs ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700"}`}
                    >
                      {env.name}
                    </code>
                    {env.required && (
                      <span className="text-red-500 text-xs">*{t("mcp.required")}</span>
                    )}
                    <span
                      className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {env.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {server.repository && (
            <div>
              <span
                className={`text-sm font-semibold ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                仓库
              </span>
              <p
                className={`text-sm mt-0.5 ${isDark ? "text-blue-400" : "text-blue-600"}`}
              >
                {server.repository}
              </p>
            </div>
          )}
        </div>

        <div
          className={`px-6 py-4 border-t flex justify-end gap-3 ${isDark ? "border-gray-700" : "border-gray-200"}`}
        >
          {isInstalled ? (
            <>
              <button
                onClick={() => onToggle(!isEnabled)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  isEnabled
                    ? "bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {isEnabled ? "禁用" : "启用"}
              </button>
              <button
                onClick={onUninstall}
                className="px-4 py-2 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 transition-colors"
              >
                {t("common.uninstall")}
              </button>
            </>
          ) : (
            <button
              onClick={onInstall}
              disabled={installing}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                installing
                  ? "bg-blue-400 text-white cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {installing ? "安装中..." : "安装"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
