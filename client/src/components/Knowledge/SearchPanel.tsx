/**
 * SearchPanel — 知识库搜索演示面板
 *
 * 从 KnowledgePage.tsx 中抽取独立组件 (CS09)。
 * P0-3: 搜索历史(localStorage 10条) + 关键词/语义得分对比 + domain筛选
 */
import React, { useState } from "react";
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
  onSearch: (domain?: string) => void;
  isSearching: boolean;
  results: KnowledgeSearchResult[];
  searchDone: boolean;
  onResultClick?: (result: KnowledgeSearchResult) => void;
}

const HISTORY_KEY = "liri-search-history";
const MAX_HISTORY = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const words = query.split(/\s+/).filter(Boolean);
  const regex = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(` ${part} `) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/40 rounded px-0.5">{part}</mark>
    ) : (
      part
    )
  );
}

function SearchPanel({
  isDark,
  demoQuery,
  onQueryChange,
  onSearch,
  isSearching,
  results,
  searchDone,
  onResultClick,
}: SearchPanelProps) {
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [domain, setDomain] = useState("");

  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const dividerColor = isDark ? "divide-gray-700" : "divide-gray-100";
  const cardBg = isDark ? "bg-gray-800" : "bg-white";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  function handleSearch() {
    const q = demoQuery.trim();
    if (!q) return;
    // 保存到历史记录
    const next = [q, ...history.filter((h) => h !== q)].slice(0, MAX_HISTORY);
    setHistory(next);
    saveHistory(next);
    onSearch(domain || undefined);
  }

  function clearHistory() {
    setHistory([]);
    saveHistory([]);
  }

  // 得分统计
  const keywordCount = results.filter((r) => r.matchType === "keyword").length;
  const semanticCount = results.filter((r) => r.matchType === "semantic").length;
  const total = keywordCount + semanticCount;
  const keywordPct = total > 0 ? Math.round((keywordCount / total) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* 搜索框 + domain 筛选 */}
        <div className={`${cardBg} rounded-lg p-4`}>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={demoQuery}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="输入检索内容，查看混合搜索效果..."
              className={`flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputBg}`}
            />
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className={`text-xs px-2 py-2 rounded-lg border ${inputBg} focus:outline-none`}
            >
              <option value="">全部域</option>
              <option value="coding">编程</option>
              <option value="botany">植物学</option>
              <option value="project">项目</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={isSearching || !demoQuery.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {isSearching ? "检索中..." : "检索"}
            </button>
          </div>
          <p className={`text-xs ${textSecondary}`}>
            混合检索（关键词 + 语义），按 RRF 融合评分排序
          </p>

          {/* 搜索历史 */}
          {history.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-400">最近搜索</span>
                <button onClick={clearHistory} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  清除
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => { onQueryChange(h); }}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
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

        {/* 结果列表 + 得分对比 */}
        {!isSearching && results.length > 0 && (
          <>
            {/* 得分占比条 */}
            <div className={`${cardBg} rounded-lg p-4`}>
              <h3 className={`text-xs font-semibold ${textPrimary} mb-2`}>
                匹配类型分布
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-green-600 dark:text-green-400 w-12">关键词</span>
                <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-400 dark:bg-green-600 rounded-full transition-all duration-300"
                    style={{ width: `${keywordPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 w-10 text-right">语义</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-green-500">{keywordCount} 条 ({keywordPct}%)</span>
                <span className="text-[10px] text-purple-500">{semanticCount} 条 ({100 - keywordPct}%)</span>
              </div>
            </div>

            <div className={`${cardBg} rounded-lg`}>
              <div className={`px-4 py-3 border-b ${borderColor} flex items-center justify-between`}>
                <h3 className={`text-sm font-semibold ${textPrimary}`}>检索结果</h3>
                <span className={`text-xs ${textSecondary}`}>
                  共 {results.length} 条结果
                </span>
              </div>
              <div className={`divide-y ${dividerColor}`}>
                {results.map((result, idx) => (
                  <div key={result.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer" onClick={() => onResultClick?.(result)}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={`text-xs font-mono ${textSecondary} w-5`}>
                          #{idx + 1}
                        </span>
                        <h4 className={`text-sm font-medium ${textPrimary} truncate`}>
                          <mark className="bg-yellow-200 dark:bg-yellow-700/40 rounded px-0.5">{result.title}</mark>
                        </h4>
                      </div>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            result.matchType === "semantic"
                              ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                              : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                          }`}
                        >
                          {result.matchType === "semantic" ? "语义" : "关键词"}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-mono">
                          {(result.score * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      <span className={result.content.length > 100 ? "line-clamp-2" : ""}>
                        {highlightMatches(result.content, demoQuery)}
                      </span>
                      {result.content.length > 100 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const el = (e.target as HTMLElement).previousElementSibling;
                            if (el) el.classList.toggle("line-clamp-2");
                            (e.target as HTMLElement).textContent =
                              el?.classList.contains("line-clamp-2") ? "展开" : "收起";
                          }}
                          className="text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 ml-1"
                        >
                          展开
                        </button>
                      )}
                    </p>
                    <div className={`text-xs ${textSecondary} mt-1`}>
                      分类: {result.category || "根目录"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 空状态引导 */}
        {!isSearching && !searchDone && (
          <div className={`${cardBg} rounded-lg p-8 text-center ${textSecondary}`}>
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">在上方输入关键词后点击「检索」，查看知识库的混合搜索效果</p>
            <p className="text-xs mt-2">支持按 domain 筛选知识库，结果展示关键词匹配与语义相似度的对比</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchPanel;
