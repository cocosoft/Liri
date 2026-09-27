import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { semanticService } from "../../services/semanticService";
import type {
  SemanticIndexStatus,
  SemanticSearchResult,
} from "../../services/semanticService";
import { SkeletonCard } from "../common/Skeleton";

/**
 * 语义索引管理页面
 * 方案规划中的管理类功能：后端 /v1/semantic/* API 的前端界面
 */
export default function SemanticIndexPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SemanticIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [buildMsg, setBuildMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>(
    [],
  );
  const [searching, setSearching] = useState(false);
  // KB-SEM-P2-1（2026-08-28）：搜索失败与"无结果"区分显示
  const [searchError, setSearchError] = useState("");
  // F4：构建轮询定时器引用（卸载时清理，防卸载后 setState / 并行构建）
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await semanticService.getStatus();
      // S1：getStatus 失败返回 null，与"索引不存在"（exists:false）区分
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleBuild = async () => {
    if (building) return; // F4：防重，避免并行构建
    setBuilding(true);
    setBuildMsg(t("semanticIndex.buildStarting"));
    // KB-SEM-P13：异步任务 + 轮询进度，避免大目录构建时 HTTP 超时误报失败
    const taskId = await semanticService.startBuild();
    if (!taskId) {
      setBuildMsg(t("semanticIndex.buildRequestFailed"));
      setBuilding(false);
      return;
    }
    const phaseLabel = (phase: string): string => {
      const labels: Record<string, string> = {
        chunking: "semanticIndex.phaseChunking",
        filtering: "semanticIndex.phaseFiltering",
        embedding: "semanticIndex.phaseEmbedding",
        storing: "semanticIndex.phaseStoring",
      };
      const key = labels[phase];
      return key ? t(key) : phase;
    };
    const poll = async (): Promise<void> => {
      const task = await semanticService.getBuildTask(taskId);
      if (!task) {
        setBuildMsg(t("semanticIndex.buildProgressFailed"));
        setBuilding(false);
        return;
      }
      if (task.status === "running") {
        const pct =
          task.total > 0
            ? `${Math.round((task.done / task.total) * 100)}%`
            : "";
        setBuildMsg(
          t("semanticIndex.buildInProgress", {
            phase: phaseLabel(task.phase),
            done: task.done,
            total: task.total,
            pct,
          }),
        );
        // F4：定时器存 ref，卸载时由 cleanup 清除
        pollTimerRef.current = setTimeout(poll, 1000);
        return;
      }
      if (task.status === "error") {
        setBuildMsg(
          t("semanticIndex.buildError", {
            error: task.error || t("semanticIndex.buildFailed"),
          }),
        );
        setBuilding(false);
        loadStatus();
        return;
      }
      // done
      const r = task.result;
      if (r) {
        if (r.ok) {
          setBuildMsg(
            t("semanticIndex.buildDone", {
              chunks: r.chunkCount,
              embedded: r.embeddedCount,
              duration: (r.durationMs / 1000).toFixed(1),
            }),
          );
        } else {
          setBuildMsg(
            t("semanticIndex.buildError", {
              error: r.error || t("semanticIndex.buildFailed"),
            }),
          );
        }
      } else {
        setBuildMsg(t("semanticIndex.buildFailedNoResult"));
      }
      setBuilding(false);
      loadStatus();
    };
    void poll();
  };

  const handleClear = async () => {
    if (!confirm(t("semanticIndex.confirmClear"))) return;
    setClearing(true);
    const ok = await semanticService.clearIndex();
    if (ok) setBuildMsg(t("semanticIndex.clearSuccess"));
    else setBuildMsg(t("semanticIndex.clearFailed"));
    setClearing(false);
    loadStatus();
  };

  // L8：搜索期间输入框可改——用 ref 记录最新输入，结果返回时校验是否仍对应本次 query
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const handleSearch = async () => {
    const q = searchQuery.trim();
    // KB-S1：去掉 searching 门闩 —— 请求期间可修改关键词并发起新搜索，
    // 过期响应由下方 L8 queryRef 校验丢弃（原实现把新搜索直接 return 吞掉，按钮也无 loading 感知）
    if (!q) return;
    setSearching(true);
    setSearchError("");
    const results = await semanticService.search(q);
    setSearching(false);
    if (results === null) {
      // KB-SEM-P2-1：搜索失败（嵌入服务不可用/维度不匹配），明确提示而非"无结果"
      setSearchError(t("semanticIndex.searchFailed"));
      setSearchResults([]);
      return;
    }
    // L8：请求期间输入已变化 → 丢弃过期结果，避免旧结果配新词
    if (searchQueryRef.current.trim() !== q) return;
    setSearchResults(results);
  };

  const formatBytes = (bytes: number | undefined): string => {
    if (!bytes) return t("semanticIndex.unknown");
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTime = (ts: number | undefined): string => {
    if (!ts) return t("semanticIndex.unknown");
    return new Date(ts).toLocaleString("zh-CN");
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
          {t("semanticIndex.pageTitle")}
        </h2>
        {/* P2#20：作用域说明——语义索引针对当前知识库根目录（~/.pyapp/knowledge），
            不区分知识库 base 子目录；如需按库隔离需后端索引分区改造 */}
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
          {t("semanticIndex.scopeHint")}
        </p>

        {/* 索引状态 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            {t("semanticIndex.statusSection")}
          </h3>
          {loading ? (
            <SkeletonCard />
          ) : status ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {status.exists ? "✅" : "❌"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("semanticIndex.indexExists")}
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {status.docCount}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("semanticIndex.docCount")}
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {status.chunkCount}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("semanticIndex.chunkCount")}
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatBytes(status.sizeBytes)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("semanticIndex.sizeLabel")}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <p className="text-red-500 dark:text-red-400">
                {t("semanticIndex.statusFetchFailed")}
              </p>
              <button
                onClick={() => void loadStatus()}
                className="mt-1 text-xs text-blue-500 dark:text-blue-400 underline"
              >
                {t("common.retry")}
              </button>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={handleBuild}
              disabled={building}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
            >
              {building
                ? t("semanticIndex.building")
                : t("semanticIndex.buildIndex")}
            </button>
            <button
              onClick={handleClear}
              disabled={clearing || !status?.exists}
              className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded"
            >
              {clearing
                ? t("semanticIndex.clearing")
                : t("semanticIndex.clearIndex")}
            </button>
          </div>

          {buildMsg && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              {buildMsg}
            </p>
          )}
        </div>

        {/* 语义搜索 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t("semanticIndex.searchSection")}
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("semanticIndex.searchPlaceholder")}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white rounded"
            >
              {searching
                ? t("semanticIndex.searching")
                : t("semanticIndex.searchAction")}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {t("semanticIndex.resultCount", {
                  count: searchResults.length,
                })}
              </p>
              {searchResults.map((r, i) => (
                <div
                  key={r.chunkId || i}
                  className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                      {r.title || t("semanticIndex.untitled")}
                    </span>
                    <span className="text-xs text-gray-400">
                      {(r.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3">
                    {r.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          {searchError && (
            <p className="mt-3 text-sm text-red-500 dark:text-red-400">
              {searchError}
            </p>
          )}

          {!searchError &&
            searchQuery.trim() &&
            !searching &&
            searchResults.length === 0 && (
              <p className="mt-3 text-sm text-gray-400">
                {t("semanticIndex.noSearchResults")}
              </p>
            )}
        </div>

        {/* 最后更新时间 */}
        {status?.lastIndexedAt && (
          <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 text-center">
            {t("semanticIndex.lastIndexedAt", {
              time: formatTime(status.lastIndexedAt),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
