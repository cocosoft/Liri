import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { currentLocale } from "../../utils/format";
// PR-3c（2026-10-23）：自动放行来源徽标（沙箱豁免 / 会话自动 / 全局信任）
import {
  APPROVAL_RULES,
  APPROVAL_RULE_LABELS,
  approvalRuleOf,
  countApprovalRules,
} from "../../utils/approvalRuleLabel";

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
  /** PR-3c（2026-10-23）：事件来源（工具名 / CLI 参数） */
  command?: string;
  /** PR-3c：命中的规则（`approval:sandbox` / `approval:auto` / `approval:trust`） */
  matchedRules?: string[];
}

/**
 * PR-3c（2026-10-23）：自动放行来源徽标 —— 映射与判定在 `utils/approvalRuleLabel`
 * （单独成模块以便 vitest 单测；数据来自后端 `matchedRules`）。
 */

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
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  /** PR-3c：近 N 条「自动放行」事件的来源分布 */
  const [approvalBreakdown, setApprovalBreakdown] = useState<{
    total: number;
    byRule: Record<string, number>;
  } | null>(null);
  /** PR-3c：最近事件按「自动放行来源」筛选（`all` = 不筛选） */
  const [ruleFilter, setRuleFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/v1/security/audit-logs?decision=auto_allowed&limit=200",
        );
        if (!res.ok) return;
        const events = (await res.json()) as Array<{ matchedRules?: string[] }>;
        if (!cancelled) setApprovalBreakdown(countApprovalRules(events));
      } catch {
        // 审计不可用不影响仪表盘主视图
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      approved: "security.decisionApproved",
      rejected: "security.decisionRejected",
      auto_allowed: "security.decisionAutoAllowed",
      auto_denied: "security.decisionAutoDenied",
      timeout_denied: "security.decisionTimeoutDenied",
    };
    const key = map[decision];
    return key ? t(key) : decision;
  }

  // 2-4：趋势柱状图比例基准（每日事件总数最大值）
  const trendTotals = (status?.trend ?? []).map((d) =>
    Object.values(d.counts).reduce((a, b) => a + b, 0),
  );
  const maxTrendTotal = Math.max(0, ...trendTotals);

  /** PR-3c：最近事件按「自动放行来源」筛选（`all` = 不筛选；无来源的事件只在 all 下出现） */
  const filteredEvents = (status?.recentEvents ?? []).filter((event) =>
    ruleFilter === "all"
      ? true
      : approvalRuleOf(event.matchedRules)?.rule === ruleFilter,
  );

  return (
    <div
      className={`p-6 min-h-screen ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      {/* 加载状态 */}
      {loading && (
        <div
          className={`p-6 ${bgCard} border rounded-lg ${textSecondary} text-center`}
        >
          {t("common.loading")}
        </div>
      )}

      {/* 空状态 */}
      {!loading && (!status || status.auditEventCount === 0) && (
        <div
          className={`p-6 ${bgCard} border rounded-lg ${textSecondary} text-center`}
        >
          {t("security.dashboardInactive")}
        </div>
      )}

      {/* 状态概览卡片 */}
      {status && status.auditEventCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className={`p-4 ${bgCard} border rounded-lg`}>
            <div className={`text-sm ${textSecondary}`}>
              {t("security.ruleCount")}
            </div>
            <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
              {status.totalRules}
            </div>
          </div>
          <div className={`p-4 ${bgCard} border rounded-lg`}>
            <div className={`text-sm ${textSecondary}`}>
              {t("security.riskDistribution")}
            </div>
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
            <div className={`text-sm ${textSecondary}`}>
              {t("security.decisionDistribution")}
            </div>
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
              {t("security.denialMonitor")}
            </h2>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <div className={`text-sm ${textSecondary}`}>
                {t("security.totalDenials")}
              </div>
              <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
                {status.denialStats.totalDenials}
              </div>
            </div>
            <div>
              <div className={`text-sm ${textSecondary}`}>
                {t("security.consecutiveDenials")}
              </div>
              <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
                {status.denialStats.consecutiveDenials}
              </div>
            </div>
            <div>
              <div className={`text-sm ${textSecondary}`}>
                {t("security.denialRate")}
              </div>
              <div className={`text-2xl font-bold mt-1 ${textPrimary}`}>
                {(status.denialStats.averageDenialRate * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className={`text-sm ${textSecondary}`}>
                {t("security.topDeniedTools")}
              </div>
              <div className="mt-1 space-y-1">
                {status.denialStats.topDeniedTools.map((tool) => (
                  <div
                    key={tool.tool}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="font-mono">{tool.tool}</span>
                    <span className={`font-medium ${textPrimary}`}>
                      {t("security.timesCount", { count: tool.count })}
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
                  {t("security.trend7d")}
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
                        {parts.join(" · ") || t("security.noEvents")}
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
                  {t("security.topBlockKinds")}
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
                      {t("security.timesCount", { count: b.count })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* PR-3c：自动放行来源分布（近端审计，最多 200 条） */}
      {approvalBreakdown && approvalBreakdown.total > 0 && (
        <div className={`${bgCard} border rounded-lg p-4`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`text-sm font-semibold ${textPrimary}`}>
              {t("security.approvalBreakdown")}
            </h2>
            <span className={`text-xs ${textSecondary}`}>
              {t("security.approvalBreakdownTotal", {
                count: approvalBreakdown.total,
              })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {APPROVAL_RULES.map((rule) => (
              <span
                key={rule}
                className={`text-xs px-2 py-0.5 rounded ${isDark ? "bg-emerald-900/40 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}
              >
                {t(APPROVAL_RULE_LABELS[rule])}：
                {approvalBreakdown.byRule[rule] ?? 0}
              </span>
            ))}
          </div>
          <p className={`text-xs mt-2 ${textSecondary}`}>
            {t("security.approvalBreakdownHint")}
          </p>
        </div>
      )}

      {/* 最近审计事件 */}
      {status && status.recentEvents.length > 0 && (
        <div className={`${bgCard} border rounded-lg overflow-hidden`}>
          <div
            className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <h2 className={`text-sm font-semibold ${textPrimary}`}>
              {t("security.recentEvents")}
            </h2>
            {/* PR-3c：按「自动放行来源」筛选最近事件 */}
            <div className="flex flex-wrap gap-1">
              {["all", ...APPROVAL_RULES].map((rule) => (
                <button
                  key={rule}
                  onClick={() => setRuleFilter(rule)}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    ruleFilter === rule
                      ? isDark
                        ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                        : "bg-emerald-50 border-emerald-500 text-emerald-700"
                      : isDark
                        ? "border-gray-600 text-gray-300 hover:border-gray-500"
                        : "border-gray-300 text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {rule === "all"
                    ? t("security.ruleFilterAll")
                    : t(APPROVAL_RULE_LABELS[rule])}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${textPrimary}`}>
              <thead className={isDark ? "bg-gray-700" : "bg-gray-50"}>
                <tr>
                  <th className="px-4 py-2 text-left font-medium">
                    {t("security.colTime")}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t("security.colCommand")}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t("security.colDecision")}
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    {t("security.colRisk")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredEvents.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className={`px-4 py-3 text-xs ${textSecondary}`}
                    >
                      {t("security.ruleFilterEmpty")}
                    </td>
                  </tr>
                )}
                {filteredEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-xs">
                      {new Date(event.timestamp).toLocaleString(
                        currentLocale(),
                      )}
                    </td>
                    <td className="px-4 py-2 max-w-md text-xs">
                      <div className="flex items-center gap-2">
                        {/* PR-3c：自动放行来源徽标（沙箱豁免 / 会话自动 / 全局信任） */}
                        {(() => {
                          const rule = approvalRuleOf(event.matchedRules);
                          if (!rule) return null;
                          return (
                            <span
                              className={`shrink-0 px-1.5 py-0.5 rounded ${isDark ? "bg-emerald-900/40 text-emerald-300" : "bg-emerald-50 text-emerald-700"}`}
                              title={rule.rule}
                            >
                              {t(rule.labelKey)}
                            </span>
                          );
                        })()}
                        <span className="truncate font-mono">
                          {event.truncatedResult}
                        </span>
                      </div>
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
