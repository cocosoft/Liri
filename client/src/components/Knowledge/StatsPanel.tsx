/**
 * StatsPanel — 知识库统计面板
 *
 * 从 KnowledgePage.tsx 中抽取独立组件 (CS09)。
 */
import { useState, useEffect } from "react";
import type { KnowledgeItem } from "../../types";
import { knowledgeService } from "../../services/knowledgeService";

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
}

interface StatsPanelProps {
  isDark: boolean;
  items: KnowledgeItem[];
}

function StatsPanel({ isDark, items }: StatsPanelProps) {
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const dividerColor = isDark ? "divide-gray-700" : "divide-gray-100";
  const cardBg = isDark ? "bg-gray-800" : "bg-white";

  useEffect(() => {
    knowledgeService
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const totalItems = items.length;
  const totalCategories = new Set(items.flatMap((i) => i.tags || [])).size;
  const recentItems = [...items]
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 10);

  // 来源分布统计 (W7: 使用类型安全的 source 字段)
  const sourceDistribution = (() => {
    const dist: Record<string, number> = {};
    for (const item of items) {
      const s = item.source ?? "unknown";
      dist[s] = (dist[s] || 0) + 1;
    }
    return Object.entries(dist).sort(([, a], [, b]) => b - a);
  })();
  const maxSourceCount = Math.max(1, ...sourceDistribution.map(([, c]) => c));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* 概览指标 */}
        <div className="grid grid-cols-3 gap-4">
          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              知识库概览
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className={`text-sm ${textSecondary}`}>总条目数</span>
                <span className={`text-sm font-medium ${textPrimary}`}>
                  {totalItems}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-sm ${textSecondary}`}>标签分类数</span>
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
                编译质量
              </h3>
              <div className="flex flex-col items-center">
                <div
                  className="relative w-20 h-20 mb-2"
                  title={`Lint 分数: ${health.lintScore}/100`}
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
                        health.lintScore >= 80
                          ? "#22c55e"
                          : health.lintScore >= 50
                            ? "#eab308"
                            : "#ef4444"
                      }
                      strokeWidth="3"
                      strokeDasharray={`${health.lintScore} ${100 - health.lintScore}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span
                    className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${textPrimary}`}
                  >
                    {health.lintScore}
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {health.lintScore >= 80
                    ? "优秀"
                    : health.lintScore >= 50
                      ? "中等"
                      : "待改善"}
                </span>
              </div>
            </div>
          )}

          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              关于知识库
            </h3>
            <div className={`space-y-2 text-sm ${textSecondary}`}>
              <p>
                知识库是 AI
                助手的「外部记忆」，您添加的知识会在对话中被自动检索和引用。
              </p>
              <p>
                系统使用混合检索策略（关键词 +
                语义），确保最相关的内容被优先匹配。
              </p>
            </div>
          </div>
        </div>

        {/* 健康仪表盘 */}
        {health && (
          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>
              知识健康度
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
                  ? "🟢 健康"
                  : health.brokenLinks + health.orphanDocs < 5
                    ? "🟡 警告"
                    : "🔴 危险"}
              </span>
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <MetricBadge
                label="断裂链接"
                value={health.brokenLinks}
                color={health.brokenLinks > 0 ? "red" : "green"}
              />
              <MetricBadge
                label="过期文档"
                value={health.expiredDocs}
                color={health.expiredDocs > 0 ? "yellow" : "green"}
              />
              <MetricBadge
                label="孤立文档"
                value={health.orphanDocs}
                color={health.orphanDocs > 0 ? "yellow" : "green"}
              />
              <MetricBadge
                label="结构错误"
                value={health.structureErrors}
                color={health.structureErrors > 0 ? "red" : "green"}
              />
              <MetricBadge
                label="一致性问题"
                value={health.consistencyWarnings}
                color={health.consistencyWarnings > 0 ? "yellow" : "green"}
              />
              <MetricBadge
                label="质量问题"
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
              来源分布
            </h3>
            <div className="space-y-2">
              {sourceDistribution.map(([source, count]) => (
                <div key={source} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 truncate">
                    {source === "manual"
                      ? "手动"
                      : source === "upload"
                        ? "上传"
                        : source === "chat-save"
                          ? "聊天"
                          : source === "compiled"
                            ? "编译"
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
            <h3 className={`text-sm font-semibold ${textPrimary}`}>最近更新</h3>
          </div>
          {recentItems.length === 0 ? (
            <div className={`px-4 py-6 text-center ${textSecondary} text-sm`}>
              暂无知识条目
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
            标签分布
          </h3>
          {totalCategories === 0 ? (
            <p className={`text-sm ${textSecondary}`}>暂无标签</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(items.flatMap((i) => i.tags || []))).map(
                (tag) => {
                  const count = items.filter((i) =>
                    (i.tags || []).includes(tag),
                  ).length;
                  return (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full"
                    >
                      {tag}
                      <span className="opacity-70">({count})</span>
                    </span>
                  );
                },
              )}
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
