import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { httpLegacy as http } from "../../services/httpClient";
import { handleClientError } from "../../utils/handleError";

/** OAuth Provider 配置（M3：来自 GET /v1/oauth/providers，只读展示） */
interface OAuthProviderInfo {
  id: string;
  name: string;
  clientId: string;
  hasClientSecret: boolean;
  redirectUri?: string;
  scopes?: string[];
  enabled: boolean;
  source: "env" | "configured";
  updatedAt?: number;
}

function OAuthPage() {
  const { t } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"providers" | "sessions">(
    "providers",
  );

  useEffect(() => {
    loadConfig();
    loadProviders();
  }, [loadConfig]);

  /** M3：真实 API 加载 provider 配置（CS04：不再 mock） */
  const loadProviders = async () => {
    setLoading(true);
    try {
      const list = await http.get<OAuthProviderInfo[]>("/v1/oauth/providers");
      setProviders(list ?? []);
      setError(null);
    } catch (e) {
      handleClientError(e, {
        module: "components:views:OAuth",
        action: "loadProviders",
      });
      setError("加载 OAuth Provider 配置失败");
    } finally {
      setLoading(false);
    }
  };

  const getProviderColor = (providerId: string) => {
    switch (providerId) {
      case "google":
        return isDark ? "bg-gray-700 text-gray-300" : "bg-white text-gray-800";
      case "github":
        return isDark ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-white";
      default:
        return isDark
          ? "bg-gray-700 text-gray-300"
          : "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("providers")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "providers"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t("oauth.providerConfig")}
          </button>
          <button
            onClick={() => setActiveTab("sessions")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "sessions"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t("oauth.activeSessions")}
          </button>
        </div>

        {/* M3：未接入标注（CS04，文案不承诺"可登录"） */}
        <div
          className={`mb-4 p-3 rounded-lg text-xs ${
            isDark
              ? "bg-yellow-900/20 text-yellow-400 border border-yellow-800"
              : "bg-yellow-50 text-yellow-700 border border-yellow-200"
          }`}
        >
          OAuth 第三方登录当前未接入。Provider 配置（clientId/clientSecret
          来自环境变量）仅作只读展示；如需管理请通过运维 API。
        </div>

        {activeTab === "providers" && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : error ? (
              <div className="text-center py-12 text-red-500">{error}</div>
            ) : providers.length === 0 ? (
              <div
                className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-12 text-center`}
              >
                <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                  未接入 OAuth 登录（未配置 Provider）
                </p>
                <p
                  className={`mt-1 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
                >
                  可通过环境变量 OAUTH_GITHUB_CLIENT_ID / OAUTH_GOOGLE_CLIENT_ID
                  或运维 API 配置
                </p>
              </div>
            ) : (
              providers.map((provider) => (
                <div
                  key={provider.id}
                  className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-5`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${getProviderColor(provider.id)}`}
                      >
                        {provider.name.charAt(0)}
                      </span>
                      <div>
                        <h3
                          className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
                        >
                          {provider.name}
                        </h3>
                        <p
                          className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}
                        >
                          来源：
                          {provider.source === "env"
                            ? "环境变量（只读）"
                            : "本地配置"}
                          {provider.updatedAt
                            ? ` · 更新于 ${new Date(provider.updatedAt).toLocaleString()}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        provider.enabled
                          ? isDark
                            ? "bg-green-900/30 text-green-400"
                            : "bg-green-100 text-green-700"
                          : isDark
                            ? "bg-gray-700 text-gray-400"
                            : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {provider.enabled
                        ? t("common.enabled")
                        : t("common.disabled")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label
                        className={`block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        Client ID
                      </label>
                      <p
                        className={`font-mono ${isDark ? "text-gray-200" : "text-gray-800"}`}
                      >
                        {provider.clientId || "—"}
                      </p>
                    </div>
                    <div>
                      <label
                        className={`block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        Client Secret
                      </label>
                      <p
                        className={`font-mono ${isDark ? "text-gray-200" : "text-gray-800"}`}
                      >
                        {provider.hasClientSecret
                          ? "******（已配置）"
                          : "未配置"}
                      </p>
                    </div>
                    {provider.redirectUri && (
                      <div className="col-span-2">
                        <label
                          className={`block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                        >
                          Redirect URI
                        </label>
                        <p
                          className={`font-mono ${isDark ? "text-gray-200" : "text-gray-800"}`}
                        >
                          {provider.redirectUri}
                        </p>
                      </div>
                    )}
                    {provider.scopes && provider.scopes.length > 0 && (
                      <div className="col-span-2">
                        <label
                          className={`block text-xs font-medium mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                        >
                          {t("oauth.scopes")}
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {provider.scopes.map((scope) => (
                            <span
                              key={scope}
                              className={`px-2 py-1 text-xs rounded-full ${isDark ? "bg-blue-900/30 text-blue-400" : "bg-blue-100 text-blue-700"}`}
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "sessions" && (
          <div
            className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"} p-6`}
          >
            <div className="text-center py-12">
              <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
                会话令牌为内存态（重启后失效），无列表 API。
              </p>
              <p
                className={`mt-1 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
              >
                已登录 Liri 云时可通过 CLI auth status 查看
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default OAuthPage;
