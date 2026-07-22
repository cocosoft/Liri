/**
 * 前端客户端错误统计卡片
 *
 * 实时显示 handleClientError 追踪的前端错误（内存统计），
 * 与后端的监控面板形成互补。
 */

import { useState, useEffect } from "react";
import { errorStats } from "../../utils/handleError";

const CATEGORY_LABELS: Record<string, string> = {
  network: "网络",
  filesystem: "文件",
  permission: "权限",
  validation: "校验",
  execution: "执行",
  configuration: "配置",
  api: "API",
  database: "数据库",
  resource: "资源",
  data: "数据",
  operation: "操作",
  unknown: "未知",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "text-gray-500",
  medium: "text-yellow-500",
  high: "text-orange-500",
  critical: "text-red-500",
};

const SEVERITY_BG: Record<string, string> = {
  low: "bg-gray-100 dark:bg-gray-700",
  medium: "bg-yellow-100 dark:bg-yellow-900",
  high: "bg-orange-100 dark:bg-orange-900",
  critical: "bg-red-100 dark:bg-red-900",
};

export function ClientErrorStats() {
  const [, setTick] = useState(0);
  const [recent, setRecent] = useState(errorStats.recent.slice(0, 10));

  // 每 5 秒轮询一次
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      setRecent(errorStats.recent.slice(0, 10));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  if (errorStats.total === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🐛</span>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            前端错误
          </h3>
        </div>
        <p className="text-sm text-green-500">✅ 无前端错误</p>
      </div>
    );
  }

  const categoryEntries = Object.entries(errorStats.byCategory).sort(
    ([, a], [, b]) => b - a,
  );
  const severityEntries = Object.entries(errorStats.bySeverity).sort(
    ([, a], [, b]) => b - a,
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🐛</span>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          前端错误 ({errorStats.total})
        </h3>
      </div>

      {/* 按严重程度 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {severityEntries.map(([severity, count]) => (
          <span
            key={severity}
            className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_BG[severity] || ""} ${SEVERITY_COLORS[severity] || ""}`}
          >
            {severity}: {count}
          </span>
        ))}
      </div>

      {/* 按分类 */}
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-3 space-y-1">
        {categoryEntries.slice(0, 5).map(([cat, count]) => (
          <div key={cat} className="flex justify-between">
            <span>{CATEGORY_LABELS[cat] || cat}</span>
            <span className="font-mono">{count}</span>
          </div>
        ))}
      </div>

      {/* 最近错误 */}
      {recent.length > 0 && (
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
            最近 {recent.length} 条
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
            {recent.map((e) => (
              <div
                key={e.id}
                className="text-xs border-l-2 border-red-400 pl-2 py-0.5"
              >
                <span className="text-gray-500">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>{" "}
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  [{e.module}]
                </span>{" "}
                <span className="text-red-600">{e.message.slice(0, 80)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
