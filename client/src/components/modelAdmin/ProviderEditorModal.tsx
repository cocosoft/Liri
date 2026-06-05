/**
 * Provider 编辑/新增弹窗组件
 * 从 ModelPage 提取的独立组件
 */

import { useCallback, useState } from "react";
import type { ProviderFormData, ProviderInfo } from "../../types";
import { PROVIDER_TYPE_LABELS } from "../../config/providerPresets";

interface ProviderEditorModalProps {
  /** 编辑模式传入 Provider，新增模式传 null */
  provider?: ProviderInfo | null;
  /** 初始表单数据（从预设填充） */
  initialFormData?: Partial<ProviderFormData>;
  isSaving: boolean;
  isDark: boolean;
  onSave: (data: ProviderFormData) => void;
  onClose: () => void;
}

export default function ProviderEditorModal({
  provider,
  initialFormData,
  isSaving,
  isDark,
  onSave,
  onClose,
}: ProviderEditorModalProps) {
  const [formData, setFormData] = useState<ProviderFormData>(() => ({
    name: provider?.name ?? initialFormData?.name ?? "",
    providerType: provider?.providerType ?? initialFormData?.providerType ?? "custom",
    baseUrl: provider?.baseUrl ?? initialFormData?.baseUrl ?? "",
    apiKey: initialFormData?.apiKey ?? "",
    modelsUrl: provider?.modelsUrl ?? initialFormData?.modelsUrl ?? "",
    notes: provider?.notes ?? initialFormData?.notes ?? "",
    requiresAuth: provider?.requiresAuth ?? initialFormData?.requiresAuth ?? true,
    icon: provider?.icon ?? initialFormData?.icon,
    iconColor: provider?.iconColor ?? initialFormData?.iconColor,
    category: provider?.category ?? initialFormData?.category,
  }));

  const handleFieldChange = useCallback(
    (field: keyof ProviderFormData, value: string | boolean) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!formData.name.trim()) return;
    onSave(formData);
  }, [formData, onSave]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {provider ? "编辑 Provider" : "新增 Provider"}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              名称 *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleFieldChange("name", e.target.value)}
              placeholder="例如: DeepSeek"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              类型
            </label>
            <select
              value={formData.providerType}
              onChange={(e) => handleFieldChange("providerType", e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
            >
              {Object.entries(PROVIDER_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Base URL *
            </label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={(e) => handleFieldChange("baseUrl", e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) => handleFieldChange("apiKey", e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              备注
            </label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => handleFieldChange("notes", e.target.value)}
              placeholder="可选备注"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requiresAuth"
              checked={!formData.requiresAuth}
              onChange={(e) => handleFieldChange("requiresAuth", !e.target.checked)}
              className="rounded"
            />
            <label
              htmlFor="requiresAuth"
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"} cursor-pointer`}
            >
              本地供应商（无需 API Key，如 Ollama / LM Studio）
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
