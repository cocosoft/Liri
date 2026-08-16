/**
 * 添加自定义模型弹窗
 *
 * 支持选择关联的 Provider（供应商），确保创建的模型可以被正确调用。
 */

import { useState } from "react";
import type { ProviderInfo } from "../../types";
import { toastWarning } from "../../stores/toastStore";

interface AddModelFormData {
  modelId: string;
  displayName: string;
  providerId: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

interface AddModelModalProps {
  /** 已启用的 Provider 列表，用于下拉选择 */
  providers: ProviderInfo[];
  onSave: (data: AddModelFormData) => void;
  onClose: () => void;
}

export default function AddModelModal({
  providers,
  onSave,
  onClose,
}: AddModelModalProps) {
  const [form, setForm] = useState<AddModelFormData>({
    modelId: "",
    displayName: "",
    providerId: providers.length > 0 ? providers[0].id : "",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          添加自定义模型
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              关联供应商 *
            </label>
            <select
              value={form.providerId}
              onChange={(e) => setForm({ ...form, providerId: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {providers.length === 0 ? (
                <option value="">-- 暂无可用供应商，请先添加 --</option>
              ) : (
                providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.providerType})
                  </option>
                ))
              )}
            </select>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              选择此模型所属的供应商，用于确定调用方式和 API 端点
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              模型 ID *
            </label>
            <input
              type="text"
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              placeholder="如: my-custom-model"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              显示名称
            </label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) =>
                setForm({ ...form, displayName: e.target.value })
              }
              placeholder="可选，默认使用模型 ID"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                上下文窗口
              </label>
              <input
                type="number"
                value={form.contextWindow}
                onChange={(e) =>
                  setForm({
                    ...form,
                    contextWindow: parseInt(e.target.value) || 200000,
                  })
                }
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                最大输出 Token
              </label>
              <input
                type="number"
                value={form.maxOutputTokens}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maxOutputTokens: parseInt(e.target.value) || 4096,
                  })
                }
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                输入定价 ($/1M tokens)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.inputCostPerMillion}
                onChange={(e) =>
                  setForm({
                    ...form,
                    inputCostPerMillion: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                输出定价 ($/1M tokens)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.outputCostPerMillion}
                onChange={(e) =>
                  setForm({
                    ...form,
                    outputCostPerMillion: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => {
              if (!form.modelId.trim()) {
                toastWarning("请输入模型 ID");
                return;
              }
              if (!form.providerId) {
                toastWarning("请先添加供应商");
                return;
              }
              onSave(form);
            }}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
          >
            创建
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
