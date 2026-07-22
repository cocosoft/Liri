/**
 * Provider 快速预设选择面板
 * 从 ModelPage 提取的独立组件
 */

import { useMemo } from "react";
import {
  getPresetsByCategory,
  CATEGORY_LABELS,
} from "../../config/providerPresets";
import type { ProviderFormData } from "../../types";

interface ProviderPresetPanelProps {
  onSelect: (formData: ProviderFormData) => void;
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  official: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  aggregator:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  third_party: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  cn_official:
    "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

const DEFAULT_COLOR =
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";

export default function ProviderPresetPanel({
  onSelect,
  onClose,
}: ProviderPresetPanelProps) {
  const grouped = useMemo(() => getPresetsByCategory(), []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          快速添加 Provider
        </h3>

        {Object.entries(grouped).map(([category, presets]) => (
          <div key={category} className="mb-5">
            <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              {CATEGORY_LABELS[category] || category}
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    onSelect({ ...preset.settingsConfig });
                    onClose();
                  }}
                  className="p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-left transition-colors border border-transparent hover:border-blue-300 dark:hover:border-blue-600"
                >
                  <div
                    className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium mb-1 ${TYPE_COLORS[preset.category] || DEFAULT_COLOR}`}
                  >
                    {preset.name}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {preset.settingsConfig.baseUrl}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={onClose}
          className="mt-2 w-full px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}
