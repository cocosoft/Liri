import { useEffect, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import {
  pricingService,
  type ModelPricingRecord,
} from "../../services/pricingService";

interface FormData {
  modelId: string;
  displayName: string;
  inputCost: string;
  outputCost: string;
  cacheReadCost: string;
  cacheWriteCost: string;
}

const emptyForm: FormData = {
  modelId: "",
  displayName: "",
  inputCost: "",
  outputCost: "",
  cacheReadCost: "",
  cacheWriteCost: "",
};

function PricingPanel() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [records, setRecords] = useState<ModelPricingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const data = await pricingService.list();
      setRecords(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载定价失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const handleSave = async () => {
    if (!form.modelId.trim()) return;
    const inputPerM = parseFloat(form.inputCost);
    const outputPerM = parseFloat(form.outputCost);
    if (isNaN(inputPerM) || isNaN(outputPerM)) return;

    setSaving(true);
    try {
      await pricingService.upsert({
        modelId: form.modelId.trim(),
        displayName: form.displayName.trim() || undefined,
        inputCostPerMillion: inputPerM,
        outputCostPerMillion: outputPerM,
        cacheReadCostPerMillion: parseFloat(form.cacheReadCost) || 0,
        cacheWriteCostPerMillion: parseFloat(form.cacheWriteCost) || 0,
      });
      setForm(emptyForm);
      setShowForm(false);
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!window.confirm(`删除 "${modelId}" 的自定义定价？`)) return;
    try {
      await pricingService.remove(modelId);
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleEdit = (r: ModelPricingRecord) => {
    setForm({
      modelId: r.modelId,
      displayName: r.displayName,
      inputCost: String(r.inputCostPerMillion),
      outputCost: String(r.outputCostPerMillion),
      cacheReadCost: String(r.cacheReadCostPerMillion || ""),
      cacheWriteCost: String(r.cacheWriteCostPerMillion || ""),
    });
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
          {records.length} 个模型定价记录
          {records.length > 0 && (
            <span className="ml-2 text-xs">
              （{records.filter((r) => r.isCustom).length} 个自定义）
            </span>
          )}
        </p>
        <button
          onClick={() => {
            setForm(emptyForm);
            setShowForm(!showForm);
          }}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          {showForm ? "取消" : "+ 新增定价"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline">
            关闭
          </button>
        </div>
      )}

      {showForm && (
        <div
          className={`p-4 rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                模型 ID *
              </label>
              <input
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                placeholder="deepseek-v4-pro"
                className={`w-full px-2 py-1.5 rounded border text-sm ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                显示名
              </label>
              <input
                value={form.displayName}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
                placeholder="DeepSeek Chat"
                className={`w-full px-2 py-1.5 rounded border text-sm ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                输入 $/1M *
              </label>
              <input
                value={form.inputCost}
                onChange={(e) =>
                  setForm({ ...form, inputCost: e.target.value })
                }
                placeholder="0.5"
                type="number"
                step="0.01"
                className={`w-full px-2 py-1.5 rounded border text-sm ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                输出 $/1M *
              </label>
              <input
                value={form.outputCost}
                onChange={(e) =>
                  setForm({ ...form, outputCost: e.target.value })
                }
                placeholder="2.0"
                type="number"
                step="0.01"
                className={`w-full px-2 py-1.5 rounded border text-sm ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                缓存读 $/1M
              </label>
              <input
                value={form.cacheReadCost}
                onChange={(e) =>
                  setForm({ ...form, cacheReadCost: e.target.value })
                }
                placeholder="0"
                type="number"
                step="0.01"
                className={`w-full px-2 py-1.5 rounded border text-sm ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                缓存写 $/1M
              </label>
              <input
                value={form.cacheWriteCost}
                onChange={(e) =>
                  setForm({ ...form, cacheWriteCost: e.target.value })
                }
                placeholder="0"
                type="number"
                step="0.01"
                className={`w-full px-2 py-1.5 rounded border text-sm ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-900"}`}
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存定价"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          暂无自定义定价。点击"新增定价"添加。
        </div>
      ) : (
        <div
          className={`rounded-lg border overflow-hidden ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className={isDark ? "bg-gray-700" : "bg-gray-50"}>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  模型 ID
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  输入 $/1M
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  输出 $/1M
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  缓存读 $/1M
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  缓存写 $/1M
                </th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400">
                  自定义
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {records.map((r) => (
                <tr
                  key={r.modelId}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                >
                  <td className="px-3 py-2 text-gray-900 dark:text-gray-200">
                    <div className="text-xs font-medium">{r.modelId}</div>
                    {r.displayName && (
                      <div className="text-[10px] text-gray-400">
                        {r.displayName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                    ${r.inputCostPerMillion}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">
                    ${r.outputCostPerMillion}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400 dark:text-gray-500">
                    {r.cacheReadCostPerMillion > 0
                      ? `$${r.cacheReadCostPerMillion}`
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400 dark:text-gray-500">
                    {r.cacheWriteCostPerMillion > 0
                      ? `$${r.cacheWriteCostPerMillion}`
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.isCustom ? (
                      <span className="text-[10px] text-blue-500">自定义</span>
                    ) : (
                      <span className="text-[10px] text-gray-400">默认</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleEdit(r)}
                      className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      编辑
                    </button>
                    {r.isCustom && (
                      <button
                        onClick={() => handleDelete(r.modelId)}
                        className="ml-1 px-2 py-1 text-xs text-red-500 hover:underline"
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PricingPanel;
