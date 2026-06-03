import { useState, useEffect, useMemo } from "react";
import { modelService } from "../../services/modelService";
import type { ModelInfo } from "../../types";

function ModelCompare() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    modelService
      .list()
      .then(setModels)
      .catch(() => {});
  }, []);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 2
          ? [...prev, id]
          : prev,
    );
  };

  const selectedModels = useMemo(() => {
    return selectedIds
      .map((id) => models.find((m) => m.id === id))
      .filter(Boolean) as ModelInfo[];
  }, [selectedIds, models]);

  const clearSelection = () => setSelectedIds([]);

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          模型对比
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          选择 2 个模型并排比较参数
        </p>
      </div>

      {/* 选择区 */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="搜索模型来选择对比..."
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          onChange={(e) => {
            const q = e.target.value.toLowerCase();
            const match = models.find(
              (m) =>
                !selectedIds.includes(m.id) &&
                (m.id.toLowerCase().includes(q) ||
                  m.name.toLowerCase().includes(q)),
            );
            if (match) toggleSelected(match.id);
          }}
        />
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            {selectedModels.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs rounded-full"
              >
                {m.name || m.id}
                <button
                  onClick={() => toggleSelected(m.id)}
                  className="text-blue-400 hover:text-blue-600"
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              onClick={clearSelection}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              清空
            </button>
          </div>
        )}
      </div>

      {/* 对比表格 */}
      {selectedModels.length === 2 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 text-gray-500 dark:text-gray-400 font-medium w-1/4">
                  参数
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-900 dark:text-gray-100 w-[37.5%]">
                  {selectedModels[0].name || selectedModels[0].id}
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-900 dark:text-gray-100 w-[37.5%]">
                  {selectedModels[1].name || selectedModels[1].id}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              <CompareRow
                label="提供商"
                a={selectedModels[0].provider}
                b={selectedModels[1].provider}
              />
              <CompareRow
                label="模型 ID"
                a={selectedModels[0].id}
                b={selectedModels[1].id}
              />
              <CompareRow
                label="上下文窗口"
                a={`${selectedModels[0].context_length?.toLocaleString() || "?"} tokens`}
                b={`${selectedModels[1].context_length?.toLocaleString() || "?"} tokens`}
              />
              <CompareRow
                label="类型"
                a={selectedModels[0].type}
                b={selectedModels[1].type}
              />
              <CompareRow
                label="状态"
                a={selectedModels[0].enabled ? "✅ 启用" : "❌ 禁用"}
                b={selectedModels[1].enabled ? "✅ 启用" : "❌ 禁用"}
              />
            </tbody>
          </table>
        </div>
      ) : selectedModels.length === 1 ? (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
          请再选择一个模型进行对比
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
          从上方搜索选择 2 个模型开始对比
        </div>
      )}
    </div>
  );
}

function CompareRow({
  label,
  a,
  b,
}: {
  label: string;
  a: string | number;
  b: string | number;
}) {
  const isDiff = String(a) !== String(b);
  return (
    <tr>
      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{label}</td>
      <td
        className={`px-4 py-3 ${isDiff ? "text-blue-600 dark:text-blue-400 font-medium" : "text-gray-900 dark:text-gray-100"}`}
      >
        {a}
      </td>
      <td
        className={`px-4 py-3 ${isDiff ? "text-green-600 dark:text-green-400 font-medium" : "text-gray-900 dark:text-gray-100"}`}
      >
        {b}
      </td>
    </tr>
  );
}

export default ModelCompare;
