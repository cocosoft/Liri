/**
 * StatsPanel — 知识库统计面板
 *
 * 从 KnowledgePage.tsx 中抽取独立组件 (CS09)。
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { knowledgeService } from "../../services/knowledgeService";
import { sourceLabelKeys } from "./shared/constants";

interface HealthMetrics {
  totalDocs: number;
  totalIssues: number;
  brokenLinks: number;
  expiredDocs: number;
  orphanDocs: number;
  structureErrors: number;
  consistencyWarnings: number;
  qualityIssues: number;
  lintScore: number;
  // KB-P2-12（2026-08-27）：统计面板聚合字段——来源/标签/最近更新
  sourceDistribution: { source: string; count: number }[];
  tagDistribution: { tag: string; count: number }[];
  recentItems: { id: string; title: string; updated_at: number }[];
}

interface StatsPanelProps {
  isDark: boolean;
}

function StatsPanel({ isDark }: StatsPanelProps) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const dividerColor = isDark ? "divide-gray-700" : "divide-gray-100";
  const cardBg = isDark ? "bg-gray-800" : "bg-white";

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    knowledgeService
      .health()
      .then((h) => setHealth(h))
      .catch(() => {
        // 加载失败与"空知识库"（health 正常返回全 0）区分
        setHealth(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`h-20 rounded-lg ${cardBg} border ${borderColor}`}
                />
              ))}
            </div>
            <div
              className={`h-40 rounded-lg ${cardBg} border ${borderColor}`}
            />
          </div>
        </div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto text-center py-16">
          <p className={`text-sm ${isDark ? "text-red-400" : "text-red-600"}`}>
            {t("knowledge.statsLoadFailed")}
          </p>
          <button
            onClick={load}
            className={`mt-3 text-xs px-3 py-1.5 rounded border ${
              isDark
                ? "border-gray-600 text-gray-300 hover:bg-gray-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  // KB-P2-12（2026-08-27）：统计数据全部来自 health 聚合接口，不再依赖 store.items 全量拉取
  const totalItems = health.totalDocs ?? 0;
  const totalCategories = health.tagDistribution.length ?? 0;
  const recentItems = health.recentItems ?? [];
  const sourceDistribution = health.sourceDistribution ?? [];
  const maxSourceCount = Math.max(1, ...sourceDistribution.map((s) => s.count));
  // L2：lintScore 越界防护（SVG 圆环需要 0-100）
  const lintScore = Math.max(0, Math.min(100, health.lintScore ?? 0));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* 概览指标 */}
        <div className="grid grid-cols-3 gap-4">
          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              {t("knowledge.overviewTitle")}
            </h3>
            {/* P2#11：口径注记——健康接口为全部知识库，未按当前库过滤 */}
            <p className="text-[10px] mb-2 opacity-60">
              {t("knowledge.statsScopeNote")}
            </p>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className={`text-sm ${textSecondary}`}>
                  {t("knowledge.totalItems")}
                </span>
                <span className={`text-sm font-medium ${textPrimary}`}>
                  {totalItems}
                </span>
              </div>
              <div className="flex justify-between items-center">
                {/* KB-L10：数据实为 tagDistribution（标签分布），文案不再误称"分类" */}
                <span className={`text-sm ${textSecondary}`}>
                  {t("knowledge.tagCount")}
                </span>
                <span className={`text-sm font-medium ${textPrimary}`}>
                  {totalCategories}
                </span>
              </div>
            </div>
          </div>

          {/* 编译质量卡片 */}
          {health && (
            <div className={`${cardBg} rounded-lg p-4`}>
              <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
                {t("knowledge.compileQuality")}
              </h3>
              <div className="flex flex-col items-center">
                <div
                  className="relative w-20 h-20 mb-2"
                  title={t("knowledge.lintScoreTooltip", { score: lintScore })}
                >
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke={isDark ? "#374151" : "#e5e7eb"}
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke={
                        lintScore >= 80
                          ? "#22c55e"
                          : lintScore >= 50
                            ? "#eab308"
                            : "#ef4444"
                      }
                      strokeWidth="3"
                      strokeDasharray={`${lintScore} ${100 - lintScore}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span
                    className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${textPrimary}`}
                  >
                    {lintScore}
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {lintScore >= 80
                    ? t("knowledge.gradeExcellent")
                    : lintScore >= 50
                      ? t("knowledge.gradeMedium")
                      : t("knowledge.gradePoor")}
                </span>
              </div>
            </div>
          )}

          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              {t("knowledge.aboutTitle")}
            </h3>
            <div className={`space-y-2 text-sm ${textSecondary}`}>
              <p>{t("knowledge.aboutDesc1")}</p>
              <p>{t("knowledge.aboutDesc2")}</p>
            </div>
          </div>
        </div>

        {/* 健康仪表盘 */}
        {health && (
          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              {t("knowledge.healthTitle")}
              <span
                className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  health.brokenLinks === 0 && health.orphanDocs === 0
                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                    : health.brokenLinks + health.orphanDocs < 5
                      ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                      : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                }`}
              >
                {health.brokenLinks === 0 && health.orphanDocs === 0
                  ? t("knowledge.healthHealthy")
                  : health.brokenLinks + health.orphanDocs < 5
                    ? t("knowledge.healthWarning")
                    : t("knowledge.healthDanger")}
              </span>
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <MetricBadge
                label={t("knowledge.brokenLinks")}
                value={health.brokenLinks}
                color={health.brokenLinks > 0 ? "red" : "green"}
              />
              <MetricBadge
                label={t("knowledge.expiredDocs")}
                value={health.expiredDocs}
                color={health.expiredDocs > 0 ? "yellow" : "green"}
              />
              <MetricBadge
                label={t("knowledge.orphanDocs")}
                value={health.orphanDocs}
                color={health.orphanDocs > 0 ? "yellow" : "green"}
              />
              <MetricBadge
                label={t("knowledge.structureErrors")}
                value={health.structureErrors}
                color={health.structureErrors > 0 ? "red" : "green"}
              />
              <MetricBadge
                label={t("knowledge.consistencyIssues")}
                value={health.consistencyWarnings}
                color={health.consistencyWarnings > 0 ? "yellow" : "green"}
              />
              <MetricBadge
                label={t("knowledge.qualityIssues")}
                value={health.qualityIssues}
                color={health.qualityIssues > 0 ? "yellow" : "green"}
              />
            </div>
          </div>
        )}

        {/* 来源分布 */}
        {sourceDistribution.length > 0 && (
          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              {t("knowledge.sourceDistribution")}
            </h3>
            <div className="space-y-2">
              {sourceDistribution.map(({ source, count }) => (
                <div key={source} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 truncate">
                    {sourceLabelKeys[source]
                      ? t(sourceLabelKeys[source])
                      : source}
                  </span>
                  <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 dark:bg-indigo-500 rounded-full transition-all"
                      style={{
                        width: `${Math.round((count / maxSourceCount) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 w-6 text-right">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 最近更新 */}
        <div className={`${cardBg} rounded-lg`}>
          <div className={`px-4 py-3 border-b ${borderColor}`}>
            <h3 className={`text-sm font-semibold ${textPrimary}`}>
              {t("knowledge.recentUpdates")}
            </h3>
          </div>
          {recentItems.length === 0 ? (
            <div className={`px-4 py-6 text-center ${textSecondary} text-sm`}>
              {t("knowledge.noEntries")}
            </div>
          ) : (
            <div className={`divide-y ${dividerColor}`}>
              {recentItems.map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-2.5 flex items-center justify-between"
                >
                  <span className={`text-sm ${textPrimary} truncate`}>
                    {item.title}
                  </span>
                  <span className={`text-xs ${textSecondary} ml-2 shrink-0`}>
                    {item.updated_at
                      ? new Date(item.updated_at).toLocaleDateString("zh-CN")
                      : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 标签分布 */}
        <div className={`${cardBg} rounded-lg p-4`}>
          <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
            {t("knowledge.tagDistribution")}
          </h3>
          {totalCategories === 0 ? (
            <p className={`text-sm ${textSecondary}`}>
              {t("knowledge.noTags")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(health?.tagDistribution ?? []).map(({ tag, count }) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full"
                >
                  {tag}
                  <span className="opacity-70">({count})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "red" | "yellow" | "green";
}) {
  const bg =
    color === "red"
      ? "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400"
      : color === "yellow"
        ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400"
        : "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400";
  return (
    <div
      className={`flex flex-col items-center py-2 px-2 rounded-lg text-center ${bg}`}
    >
      <span className="text-lg font-bold">{value}</span>
      <span className="text-[10px] mt-0.5">{label}</span>
    </div>
  );
}

export default StatsPanel;
