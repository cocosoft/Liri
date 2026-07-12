/**
 * SearchPanel — 知识库搜索演示面板
 *
 * 从 KnowledgePage.tsx 中抽取独立组件 (CS09)。
 */
import { SkeletonCard } from "../common/Skeleton";

interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  category?: string;
  matchType: string;
  score: number;
}

interface SearchPanelProps {
  isDark: boolean;
  demoQuery: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  results: KnowledgeSearchResult[];
  searchDone: boolean;
}

function SearchPanel({
  isDark,
  demoQuery,
  onQueryChange,
  onSearch,
  isSearching,
  results,
  searchDone,
}: SearchPanelProps) {
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const dividerColor = isDark ? "divide-gray-700" : "divide-gray-100";
  const cardBg = isDark ? "bg-gray-800" : "bg-white";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* 搜索框 */}
        <div className={`${cardBg} rounded-lg p-4`}>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={demoQuery}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder="输入检索内容，查看混合搜索效果..."
              className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputBg}`}
            />
            <button
              onClick={onSearch}
              disabled={isSearching || !demoQuery.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {isSearching ? "检索中..." : "检索"}
            </button>
          </div>
          <p className={`text-xs ${textSecondary}`}>
            使用 HybridKnowledgeRouter 进行混合检索（关键词匹配 + 语义相似度），结果按相关性评分排序
          </p>
        </div>

        {/* 加载骨架 */}
        {isSearching && (
          <div className={`${cardBg} rounded-lg p-6`}>
            <div className="space-y-3">
              <SkeletonCard count={3} />
            </div>
          </div>
        )}

        {/* 无结果 */}
        {!isSearching && results.length === 0 && searchDone && (
          <div className={`${cardBg} rounded-lg p-6 text-center ${textSecondary}`}>
            未找到匹配的知识条目
          </div>
        )}

        {/* 结果列表 */}
        {!isSearching && results.length > 0 && (
          <div className={`${cardBg} rounded-lg`}>
            <div className={`px-4 py-3 border-b ${borderColor} flex items-center justify-between`}>
              <h3 className={`text-sm font-semibold ${textPrimary}`}>检索结果</h3>
              <span className={`text-xs ${textSecondary}`}>
                共 {results.length} 条结果
              </span>
            </div>
            <div className={`divide-y ${dividerColor}`}>
              {results.map((result, idx) => (
                <div key={result.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`text-xs font-mono ${textSecondary} w-5`}>
                        #{idx + 1}
                      </span>
                      <h4 className={`text-sm font-medium ${textPrimary} truncate`}>
                        {result.title}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          result.matchType === "semantic"
                            ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                            : result.matchType === "keyword"
                              ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {result.matchType === "semantic" ? "语义" : result.matchType === "keyword" ? "关键词" : result.matchType}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-mono">
                        {(result.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <p className={`text-xs ${textSecondary} line-clamp-2 mt-1`}>
                    {result.content}
                  </p>
                  <div className={`text-xs ${textSecondary} mt-1`}>
                    分类: {result.category || "根目录"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 空状态引导 */}
        {!isSearching && !searchDone && (
          <div className={`${cardBg} rounded-lg p-8 text-center ${textSecondary}`}>
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">在上方输入关键词后点击「检索」，查看知识库的混合搜索效果</p>
            <p className="text-xs mt-2">系统会同时使用关键词匹配和语义相似度双通道检索，并显示每条结果的匹配类型和相关性评分</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchPanel;
