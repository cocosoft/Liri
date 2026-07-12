/**
 * StatsPanel — 知识库统计面板
 *
 * 从 KnowledgePage.tsx 中抽取独立组件 (CS09)。
 */
import type { KnowledgeItem } from "../../types";

interface StatsPanelProps {
  isDark: boolean;
  items: KnowledgeItem[];
  demoSearchDone: boolean;
  demoResultCount: number;
}

function StatsPanel({ isDark, items, demoSearchDone, demoResultCount }: StatsPanelProps) {
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const dividerColor = isDark ? "divide-gray-700" : "divide-gray-100";
  const cardBg = isDark ? "bg-gray-800" : "bg-white";

  const totalItems = items.length;
  const totalCategories = new Set(items.flatMap((i) => i.tags || [])).size;
  const recentItems = [...items]
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 10);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* 概览指标 */}
        <div className="grid grid-cols-2 gap-4">
          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>知识库概览</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className={`text-sm ${textSecondary}`}>总条目数</span>
                <span className={`text-sm font-medium ${textPrimary}`}>{totalItems}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-sm ${textSecondary}`}>标签分类数</span>
                <span className={`text-sm font-medium ${textPrimary}`}>{totalCategories}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-sm ${textSecondary}`}>检索匹配数</span>
                <span className={`text-sm font-medium ${textPrimary}`}>
                  {demoSearchDone ? demoResultCount : "-"}
                </span>
              </div>
            </div>
          </div>

          <div className={`${cardBg} rounded-lg p-4`}>
            <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>关于知识库</h3>
            <div className={`space-y-2 text-sm ${textSecondary}`}>
              <p>知识库是 AI 助手的「外部记忆」，您添加的知识会在对话中被自动检索和引用。</p>
              <p>系统使用混合检索策略（关键词 + 语义），确保最相关的内容被优先匹配。</p>
            </div>
          </div>
        </div>

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
                <div key={item.id} className="px-4 py-2.5 flex items-center justify-between">
                  <span className={`text-sm ${textPrimary} truncate`}>{item.title}</span>
                  <span className={`text-xs ${textSecondary} ml-2 shrink-0`}>
                    {item.updated_at ? new Date(item.updated_at).toLocaleDateString("zh-CN") : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 标签分布 */}
        <div className={`${cardBg} rounded-lg p-4`}>
          <h3 className={`text-sm font-semibold ${textPrimary} mb-3`}>标签分布</h3>
          {totalCategories === 0 ? (
            <p className={`text-sm ${textSecondary}`}>暂无标签</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(items.flatMap((i) => i.tags || []))).map((tag) => {
                const count = items.filter((i) => (i.tags || []).includes(tag)).length;
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full"
                  >
                    {tag}
                    <span className="opacity-70">({count})</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StatsPanel;
