import { useState, useEffect } from "react";

interface UsageData {
  range: string;
  sessions: number;
  totalTokens: number;
  byModel: Record<string, number>;
  toolCalls: Record<string, number>;
  subAgents: Record<string, number>;
  cost: { estimated: number; currency: string };
}

const RANGE_OPTIONS = [
  { label: "当前", value: "current" },
  { label: "今天", value: "today" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 用量统计面板：Token 消耗 / 工具调用 / 费用 */
export default function UsagePanel() {
  const [range, setRange] = useState("current");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/v1/usage?range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [range]);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
        用量统计
      </h2>

      {/* 时间范围选择 */}
      <div className="flex gap-1">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setRange(opt.value)}
            className={`px-2 py-1 text-xs rounded ${
              range === opt.value
                ? "bg-blue-500 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : !data ? (
        <p className="text-sm text-gray-400">暂无数据</p>
      ) : (
        <div className="space-y-3">
          {/* Token 总览 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-500">总 Token</p>
              <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                {formatTokens(data.totalTokens)}
              </p>
            </div>
            <div className="p-3 rounded bg-gray-50 dark:bg-gray-800/50">
              <p className="text-xs text-gray-500">预估费用</p>
              <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                ${data.cost.estimated.toFixed(2)}
              </p>
            </div>
          </div>

          {/* 按模型分解 */}
          {Object.keys(data.byModel).length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">按模型</p>
              {Object.entries(data.byModel).map(([model, tokens]) => (
                <div
                  key={model}
                  className="flex justify-between text-xs py-1 border-b border-gray-100 dark:border-gray-800"
                >
                  <span className="text-gray-600 dark:text-gray-300">
                    {model}
                  </span>
                  <span className="text-gray-500">{formatTokens(tokens)}</span>
                </div>
              ))}
            </div>
          )}

          {/* 工具调用 */}
          {Object.keys(data.toolCalls).length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">工具调用</p>
              {Object.entries(data.toolCalls)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([tool, count]) => (
                  <div
                    key={tool}
                    className="flex justify-between text-xs py-1 border-b border-gray-100 dark:border-gray-800"
                  >
                    <span className="text-gray-600 dark:text-gray-300">
                      {tool}
                    </span>
                    <span className="text-gray-500">{count} 次</span>
                  </div>
                ))}
            </div>
          )}

          {/* 会话数 */}
          <p className="text-xs text-gray-400">共 {data.sessions} 个会话</p>
        </div>
      )}
    </div>
  );
}
