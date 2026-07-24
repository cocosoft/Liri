import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApiKeyStore } from "../../stores/authStore";
import { useConfigStore } from "../../stores/configStore";
import { handleClientError } from "../../utils/handleError";

function ApiKeyPage() {
  const { t } = useTranslation();
  const { apiKeys, isLoading, error, loadApiKeys, createApiKey, deleteApiKey } =
    useApiKeyStore();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setCreateError(t("settings.apiKeyNameRequired"));
      return;
    }

    setCreateError(null);
    try {
      const key = await createApiKey(newKeyName, ["read"], 90);
      setNewKeyValue(key);
      setNewKeyName("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("common.failed"));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("settings.confirmDeleteApiKey"))) {
      return;
    }

    try {
      await deleteApiKey(id);
    } catch (e) {
      handleClientError(e, {
        module: "components:views:ApiKey",
        action: "deleteApiKey",
      });
    }
  };

  const handleCopy = async () => {
    if (newKeyValue) {
      try {
        await navigator.clipboard.writeText(newKeyValue);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        handleClientError(e, {
          module: "components:views:ApiKey",
          action: "copyKey",
        });
      }
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {t("settings.apiKeyManagement")}
            </h1>
            <p
              className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {t("settings.apiKeyDesc")}
            </p>
          </div>
          <button
            onClick={() => {
              setShowCreateModal(true);
              setNewKeyValue(null);
              setNewKeyName("");
              setCreateError(null);
            }}
            className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${
              isDark
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {t("settings.createApiKey")}
          </button>
        </div>

        {(error || createError) && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${isDark ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-red-50 text-red-600 border border-red-200"}`}
          >
            {error || createError}
          </div>
        )}

        {isLoading && apiKeys.length === 0 ? (
          <div
            className={`text-center py-12 ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {t("common.loading")}
          </div>
        ) : apiKeys.length === 0 ? (
          <div
            className={`text-center py-12 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
          >
            <svg
              className={`w-12 h-12 mx-auto mb-4 ${isDark ? "text-gray-500" : "text-gray-400"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
            <p className={`${isDark ? "text-gray-400" : "text-gray-500"}`}>
              {t("settings.noApiKeys")}
            </p>
            <p
              className={`mt-1 text-sm ${isDark ? "text-gray-500" : "text-gray-400"}`}
            >
              {t("settings.noApiKeysHint")}
            </p>
          </div>
        ) : (
          <div
            className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
          >
            <table className="w-full">
              <thead>
                <tr
                  className={`text-left text-sm border-b ${isDark ? "border-gray-700 text-gray-400" : "border-gray-200 text-gray-500"}`}
                >
                  <th className="px-4 py-3 font-medium">{t("common.name")}</th>
                  <th className="px-4 py-3 font-medium">
                    {t("settings.apiKey")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("settings.createdAt")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("settings.lastUsed")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("settings.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {apiKeys.map((key) => (
                  <tr
                    key={key.id}
                    className={`${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {key.key_prefix}...****
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatDate(key.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {key.last_used_at
                        ? formatDate(key.last_used_at)
                        : t("settings.neverUsed")}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(key.id)}
                        className={`text-sm hover:underline ${isDark ? "text-red-400" : "text-red-600"}`}
                      >
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className={`max-w-md w-full mx-4 p-6 rounded-xl ${isDark ? "bg-gray-800" : "bg-white"}`}
          >
            {newKeyValue ? (
              <>
                <h2
                  className={`text-lg font-bold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  {t("settings.apiKeyCreated")}
                </h2>
                <div
                  className={`p-3 rounded-lg mb-4 ${isDark ? "bg-yellow-900/30 border border-yellow-700" : "bg-yellow-50 border border-yellow-200"}`}
                >
                  <p
                    className={`text-sm ${isDark ? "text-yellow-400" : "text-yellow-700"}`}
                  >
                    {t("settings.apiKeyCopyWarning")}
                  </p>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    value={newKeyValue}
                    readOnly
                    className={`flex-1 px-3 py-2 text-sm font-mono border rounded-lg ${isDark ? "bg-gray-700 border-gray-600 text-gray-300" : "bg-gray-50 border-gray-300 text-gray-700"}`}
                  />
                  <button
                    onClick={handleCopy}
                    className={`px-3 py-2 text-sm rounded-lg ${copied ? "bg-green-600 text-white" : isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700"}`}
                  >
                    {copied ? t("settings.copied") : t("common.copy")}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewKeyValue(null);
                  }}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                >
                  {t("common.confirm")}
                </button>
              </>
            ) : (
              <>
                <h2
                  className={`text-lg font-bold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
                >
                  {t("settings.createApiKey")}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label
                      className={`block text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"} mb-1`}
                    >
                      {t("settings.apiKeyName")}
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder={t("settings.apiKeyNamePlaceholder")}
                      className={`w-full px-3 py-2 text-sm border rounded-lg ${
                        isDark
                          ? "bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400"
                          : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                      } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className={`flex-1 py-2 border rounded-lg font-medium ${
                        isDark
                          ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                          : "border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={isLoading}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
                    >
                      {isLoading ? t("settings.creating") : t("common.create")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ApiKeyPage;
