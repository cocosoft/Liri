/**
 * 添加自定义模型弹窗
 *
 * 支持选择关联的 Provider（供应商），确保创建的模型可以被正确调用。
 * 价格配置：token 计价（输入/输出/缓存）+ 计费模式（按次）+ 分时价差。
 */

import { useState } from "react";
import type { BillingMode, ProviderInfo, TimeBasedPrice } from "../../types";
import { toastWarning } from "../../stores/toastStore";

interface AddModelFormData {
  modelId: string;
  displayName: string;
  providerId: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheWriteCostPerMillion: number;
  billingMode: BillingMode;
  pricePerRequest: number;
  timeBasedPricing: TimeBasedPrice[];
}

interface AddModelModalProps {
  /** 已启用的 Provider 列表，用于下拉选择 */
  providers: ProviderInfo[];
  onSave: (data: AddModelFormData) => void;
  onClose: () => void;
}

const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  token: "按 Token 计费",
  per_request: "按次计费",
  token_and_per_request: "按 Token + 按次",
};

function emptyTimeSlot(): TimeBasedPrice {
  return {
    start: "00:00",
    end: "00:00",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  };
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
    cacheReadCostPerMillion: 0,
    cacheWriteCostPerMillion: 0,
    billingMode: "token",
    pricePerRequest: 0,
    timeBasedPricing: [],
  });

  const updateSlot = (index: number, patch: Partial<TimeBasedPrice>) => {
    setForm({
      ...form,
      timeBasedPricing: form.timeBasedPricing.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      ),
    });
  };

  const inputCls =
    "w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

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
              className={inputCls}
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
              className={inputCls}
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
              className={inputCls}
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
                className={inputCls}
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
                className={inputCls}
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
                className={inputCls}
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
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                缓存命中输入 ($/1M)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.cacheReadCostPerMillion}
                onChange={(e) =>
                  setForm({
                    ...form,
                    cacheReadCostPerMillion: parseFloat(e.target.value) || 0,
                  })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                缓存写入 ($/1M)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.cacheWriteCostPerMillion}
                onChange={(e) =>
                  setForm({
                    ...form,
                    cacheWriteCostPerMillion: parseFloat(e.target.value) || 0,
                  })
                }
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                计费模式
              </label>
              <select
                value={form.billingMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    billingMode: e.target.value as BillingMode,
                  })
                }
                className={inputCls}
              >
                {(Object.keys(BILLING_MODE_LABELS) as BillingMode[]).map(
                  (m) => (
                    <option key={m} value={m}>
                      {BILLING_MODE_LABELS[m]}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                按次单价 ($/请求)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.pricePerRequest}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pricePerRequest: parseFloat(e.target.value) || 0,
                  })
                }
                disabled={form.billingMode === "token"}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                分时价差（可选，如 DeepSeek 错峰优惠）
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    timeBasedPricing: [
                      ...form.timeBasedPricing,
                      emptyTimeSlot(),
                    ],
                  })
                }
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                + 添加时段
              </button>
            </div>
            {form.timeBasedPricing.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                无分时价差，按上述默认价计费
              </p>
            ) : (
              <div className="space-y-2">
                {form.timeBasedPricing.map((slot, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2"
                  >
                    <input
                      type="time"
                      value={slot.start}
                      onChange={(e) => updateSlot(i, { start: e.target.value })}
                      className="px-1.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded"
                    />
                    <span className="text-gray-400">至</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={(e) => updateSlot(i, { end: e.target.value })}
                      className="px-1.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="输入 $/1M"
                      value={slot.inputCostPerMillion ?? ""}
                      onChange={(e) =>
                        updateSlot(i, {
                          inputCostPerMillion: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-20 px-1.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="输出 $/1M"
                      value={slot.outputCostPerMillion ?? ""}
                      onChange={(e) =>
                        updateSlot(i, {
                          outputCostPerMillion: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-20 px-1.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          timeBasedPricing: form.timeBasedPricing.filter(
                            (_, idx) => idx !== i,
                          ),
                        })
                      }
                      className="text-red-500 hover:text-red-600"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              end 早于 start 表示跨天时段（如 21:30-08:00）
            </p>
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
