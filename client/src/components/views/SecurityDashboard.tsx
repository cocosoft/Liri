import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";

/**
 * 安全仪表盘
 * P3-04: 显示安全状态、审计事件摘要和规则风险分布
 */

interface AuditEventSummary {
  id: string;
  timestamp: string;
  decision: string;
  riskLevel: string;
  truncatedResult: string;
  behavior: string;
}

interface SecurityStatus {
  /** 权限规则总数（A 体系 tool_rules.json） */
  totalRules: number;
  activePolicies: number;
  /** 审计事件总数 */
  auditEventCount: number;
  recentEvents: AuditEventSummary[];
  riskDistribution: Record<string, number>;
  decisionDistribution: Record<string, number>;
  denialStats?: {
    totalDenials: number;
    consecutiveDenials: number;
    averageDenialRate: number;
    suggestion?: string;
    topDeniedTools: Array<{ tool: string; count: number }>;
  };
  /** 2-4：近 7 日按日决策趋势（后端新字段，兼容缺失） */
  trend?: Array<{ date: string; counts: Record<string, number> }>;
  /** 2-4：越权拦截类别 Top（2-1 logSecurityBlock 事件） */
  topBlockKinds?: Array<{ kind: string; count: number }>;
}

/** 从后端获取安全状态数据 */
async function fetchSecurityStatus(): Promise<SecurityStatus> {
  try {
    const response = await fetch("/v1/security/dashboard");
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } catch {
    // 后端 API 不可用时返回空状态
    return {
      totalRules: 0,
      activePolicies: 0,
      auditEventCount: 0,
      recentEvents: [],
      riskDistribution: {},
      decisionDistribution: {},
    };
  }
}

function SecurityDashboard() {
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSecurityStatus();
      // 去重：后端可能返回重复 ID 的事件
      if (data.recentEvents.length > 0) {
        const seen = new Set<string>();
        data.recentEvents = data.recentEvents.filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
      }
      setStatus(data);
    } catch {
      // 静默处理
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const bgCard = isDark
    ? "bg-gray-800 border-gray-700"
    : "bg-white border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const badgeCritical =
    "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  const badgeHigh =
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
  const badgeMedium =
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";

  /** 获取风险等级对应的 badge 样式 */
  function riskBadgeClass(level: string): string {
    switch (level) {
      case "critical":
        return badgeCritical;
      case "high":
        return badgeHigh;
      case "medium":
        return badgeMedium;
      default:
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    }
  }

  /** 获取决策对应的中文描述 */
  function decisionLabel(decision: string): string {
    const map: Record<string, string> = {
      approved: "已批准",
      rejected: "已拒绝",
      auto_allowed: "自动放行",
      auto_denied: "自动拒绝",
      timeout_denied: "超时拒绝",
    };
    return map[decision] || decision;
  }

  // 2-4：趋势柱状图比例基准（每日事件总数最大值）
  const trendTotals = (status?.trend ?? []).map((d) =>
    Object.values(d.counts).reduce((a, b) => a + b, 0),
  );
  const maxTrendTotal = Math.max(0, ...trendTotals);

  return (
    <div
      className={`p-6 min-h-screen ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      {/* 加载状态 */}
      {loading && (
        <div
          className={`p-6 ${bgCard} border rounded-lg ${textSecondary} text-center`}
        >
          加载中...
        </div>
      )}

      {/* 空状态 */}
      {!loading && (!status || status.auditEventCount === 0) && (
        <div
          className={`p-6 ${bgCard} border rounded-lg ${textSecondary} text-center`}
        >
          安全仪表盘尚未激活，请确保后端安全服务已启动。
        </div>
      )}

      {/* 状态概览卡片 */}
      {status && status.auditEventCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className={`p-4 ${bgCard} border rounded-lg`}>
            <div className={`text-sm ${textSecondary}`}>权限规则数</div>
            <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
              {status.totalRules}
            </div>
          </div>
          <div className={`p-4 ${bgCard} border rounded-lg`}>
            <div className={`text-sm ${textSecondary}`}>风险等级分布</div>
            <div className="mt-2 space-y-1">
              {Object.entries(status.riskDistribution).map(([level, count]) => (
                <div key={level} className="flex items-center justify-between">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${riskBadgeClass(level)}`}
                  >
                    {level}
                  </span>
                  <span className={`text-sm font-medium ${textPrimary}`}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className={`p-4 ${bgCard} border rounded-lg`}>
            <div className={`text-sm ${textSecondary}`}>决策分布</div>
            <div className="mt-2 space-y-1">
              {Object.entries(status.decisionDistribution).map(
                ([decision, count]) => (
                  <div
                    key={decision}
                    className="flex items-center justify-between"
                  >
                    <span className={`text-xs ${textSecondary}`}>
                      {decisionLabel(decision)}
                    </span>
                    <span className={`text-sm font-medium ${textPrimary}`}>
                      {count}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* 权限拒绝监测（DenialTracker 指标） */}
      {status?.denialStats && status.denialStats.totalDenials > 0 && (
        <div className={`${bgCard} border rounded-lg mb-6`}>
          <div
            className={`px-4 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <h2 className={`text-sm font-semibold ${textPrimary}`}>
              权限拒绝监测
            </h2>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className={`text-sm ${textSecondary}`}>累计拒绝</div>
              <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
                {status.denialStats.totalDenials}
              </div>
            </div>
            <div>
              <div className={`text-sm ${textSecondary}`}>连续拒绝</div>
              <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
                {status.denialStats.consecutiveDenials}
              </div>
            </div>
            <div>
              <div className={`text-sm ${textSecondary}`}>拒绝率</div>
              <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
                {(status.denialStats.averageDenialRate * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className={`text-sm ${textSecondary}`}>被拒最多工具</div>
              <div className="mt-1 space-y-1">
                {status.denialStats.topDeniedTools.map((t) => (
                  <div
                    key={t.tool}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="font-mono">{t.tool}</span>
                    <span className={`font-medium ${textPrimary}`}>
                      {t.count} 次
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {status.denialStats.suggestion && (
            <div
              className={`px-4 py-2 border-t text-xs ${badgeMedium} ${isDark ? "border-gray-700" : "border-gray-200"}`}
            >
              {status.denialStats.suggestion}
            </div>
          )}
        </div>
      )}

      {/* 2-4：近 7 日决策趋势 + 越权拦截类别 Top */}
      {(status?.trend && status.trend.length > 0) ||
      (status?.topBlockKinds && status.topBlockKinds.length > 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {status.trend && status.trend.length > 0 && (
            <div className={`${bgCard} border rounded-lg`}>
              <div
                className={`px-4 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
              >
                <h2 className={`text-sm font-semibold ${textPrimary}`}>
                  近 7 日决策趋势
                </h2>
              </div>
              <div className="p-4 space-y-2">
                {status.trend.map((d) => {
                  const total = Object.values(d.counts).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  const parts = Object.entries(d.counts)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${decisionLabel(k)} ${v}`);
                  return (
                    <div
                      key={d.date}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span className={`w-16 shrink-0 ${textSecondary}`}>
                        {d.date.slice(5)}
                      </span>
                      <div
                        className={`flex-1 h-2 rounded overflow-hidden ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
                      >
                        <div
                          className="h-full bg-blue-500"
                          style={{
                            width: `${maxTrendTotal > 0 ? (total / maxTrendTotal) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span
                        className={`w-28 shrink-0 text-right truncate ${textPrimary}`}
                        title={parts.join(" · ")}
                      >
                        {parts.join(" · ") || "无事件"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {status.topBlockKinds && status.topBlockKinds.length > 0 && (
            <div className={`${bgCard} border rounded-lg`}>
              <div
                className={`px-4 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
              >
                <h2 className={`text-sm font-semibold ${textPrimary}`}>
                  越权拦截类别 Top
                </h2>
              </div>
              <div className="p-4 space-y-1">
                {status.topBlockKinds.map((b) => (
                  <div
                    key={b.kind}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-mono text-xs">{b.kind}</span>
                    <span className={`font-medium ${textPrimary}`}>
                      {b.count} 次
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* 最近审计事件 */}
      {status && status.recentEvents.length > 0 && (
        <div className={`${bgCard} border rounded-lg overflow-hidden`}>
          <div
            className={`px-4 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <h2 className={`text-sm font-semibold ${textPrimary}`}>
              最近安全事件
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${textPrimary}`}>
              <thead className={isDark ? "bg-gray-700" : "bg-gray-50"}>
                <tr>
                  <th className="px-4 py-2 text-left font-medium">时间</th>
                  <th className="px-4 py-2 text-left font-medium">命令</th>
                  <th className="px-4 py-2 text-left font-medium">决策</th>
                  <th className="px-4 py-2 text-left font-medium">风险</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {status.recentEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-xs">
                      {new Date(event.timestamp).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-4 py-2 max-w-md truncate font-mono text-xs">
                      {event.truncatedResult}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${riskBadgeClass(event.riskLevel)}`}
                      >
                        {decisionLabel(event.decision)}
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${riskBadgeClass(event.riskLevel)}`}
                      >
                        {event.riskLevel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default SecurityDashboard;
