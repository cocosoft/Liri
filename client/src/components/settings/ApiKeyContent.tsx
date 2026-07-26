import { useState, useEffect } from "react";
import { useApiKeyStore } from "../../stores/authStore";
import { handleClientError } from "../../utils/handleError";

/** API 密钥管理面板 — 从 SettingsPage.tsx 提取 */
function ApiKeyContent() {
  const { apiKeys, isLoading, error, loadApiKeys, createApiKey, deleteApiKey } =
    useApiKeyStore();
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
      setCreateError("请输入密钥名称");
      return;
    }
    setCreateError(null);
    try {
      const key = await createApiKey(newKeyName, ["read"], 90);
      setNewKeyValue(key);
      setNewKeyName("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个 API 密钥吗？此操作不可撤销。")) return;
    try {
      await deleteApiKey(id);
    } catch (e) {
      handleClientError(e, {
        module: "components:views:Settings",
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
          module: "components:views:Settings",
          action: "copyKey",
        });
      }
    }
  };

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="p-6">
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => {
            setShowCreateModal(true);
            setNewKeyValue(null);
            setNewKeyName("");
            setCreateError(null);
          }}
          className="px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          创建密钥
        </button>
      </div>

      {(error || createError) && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error || createError}
        </div>
      )}

      {isLoading && apiKeys.length === 0 ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-12 rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <svg
            className="w-12 h-12 mx-auto mb-4 text-gray-400"
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
          <p className="text-gray-500">暂无 API 密钥</p>
          <p className="mt-1 text-sm text-gray-400">
            点击上方按钮创建一个新的 API 密钥
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">密钥</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">最后使用</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {apiKeys.map((key) => (
                <tr key={key.id} className="text-gray-700 dark:text-gray-300">
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
                      : "从未使用"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-w-md w-full mx-4 p-6 rounded-xl bg-white dark:bg-gray-800">
            {newKeyValue ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  密钥已创建
                </h3>
                <div className="p-3 rounded bg-gray-50 dark:bg-gray-700">
                  <code className="text-sm break-all text-gray-800 dark:text-gray-200">
                    {newKeyValue}
                  </code>
                </div>
                <p className="text-xs text-red-500 mt-2">
                  请立即复制，关闭后将无法再次查看
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleCopy}
                    className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {copied ? "已复制" : "复制密钥"}
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  创建新密钥
                </h3>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="密钥名称"
                  className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 mb-4"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    创建
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ApiKeyContent;
