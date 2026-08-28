import { useState, useEffect, useCallback, useRef } from "react";
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
    setBuildMsg("正在启动构建...");
    // KB-SEM-P13：异步任务 + 轮询进度，避免大目录构建时 HTTP 超时误报失败
    const taskId = await semanticService.startBuild();
    if (!taskId) {
      setBuildMsg("❌ 构建请求失败");
      setBuilding(false);
      return;
    }
    const phaseLabel = (phase: string): string => {
      const labels: Record<string, string> = {
        chunking: "分块",
        filtering: "过滤",
        embedding: "嵌入",
        storing: "存储",
      };
      return labels[phase] ?? phase;
    };
    const poll = async (): Promise<void> => {
      const task = await semanticService.getBuildTask(taskId);
      if (!task) {
        setBuildMsg("❌ 获取构建进度失败");
        setBuilding(false);
        return;
      }
      if (task.status === "running") {
        const pct =
          task.total > 0
            ? `${Math.round((task.done / task.total) * 100)}%`
            : "";
        setBuildMsg(
          `构建中... ${phaseLabel(task.phase)} ${task.done}/${task.total} ${pct}`,
        );
        // F4：定时器存 ref，卸载时由 cleanup 清除
        pollTimerRef.current = setTimeout(poll, 1000);
        return;
      }
      if (task.status === "error") {
        setBuildMsg(`❌ ${task.error || "构建失败"}`);
        setBuilding(false);
        loadStatus();
        return;
      }
      // done
      const r = task.result;
      if (r) {
        if (r.ok) {
          setBuildMsg(
            `✅ 构建完成 — ${r.chunkCount} 个分块, ${r.embeddedCount} 个嵌入, 耗时 ${(r.durationMs / 1000).toFixed(1)}s`,
          );
        } else {
          setBuildMsg(`❌ ${r.error || "构建失败"}`);
        }
      } else {
        setBuildMsg("❌ 构建失败（无结果）");
      }
      setBuilding(false);
      loadStatus();
    };
    void poll();
  };

  const handleClear = async () => {
    if (!confirm("确定要清除语义索引吗？此操作不可恢复。")) return;
    setClearing(true);
    const ok = await semanticService.clearIndex();
    if (ok) setBuildMsg("✅ 索引已清除");
    else setBuildMsg("❌ 清除失败");
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
      setSearchError(
        "搜索失败：嵌入服务不可用或索引模型不匹配，请检查嵌入配置后重试",
      );
      setSearchResults([]);
      return;
    }
    // L8：请求期间输入已变化 → 丢弃过期结果，避免旧结果配新词
    if (searchQueryRef.current.trim() !== q) return;
    setSearchResults(results);
  };

  const formatBytes = (bytes: number | undefined): string => {
    if (!bytes) return "未知";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTime = (ts: number | undefined): string => {
    if (!ts) return "未知";
    return new Date(ts).toLocaleString("zh-CN");
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          语义索引管理
        </h2>

        {/* 索引状态 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            索引状态
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
                  索引存在
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {status.docCount}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  文档数
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {status.chunkCount}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  片段数
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatBytes(status.sizeBytes)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  大小
                </p>
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <p className="text-red-500 dark:text-red-400">状态获取失败</p>
              <button
                onClick={() => void loadStatus()}
                className="mt-1 text-xs text-blue-500 dark:text-blue-400 underline"
              >
                重试
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
              {building ? "构建中..." : "构建索引"}
            </button>
            <button
              onClick={handleClear}
              disabled={clearing || !status?.exists}
              className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded"
            >
              {clearing ? "清除中..." : "清除索引"}
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
            语义搜索（测试）
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入搜索关键词..."
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white rounded"
            >
              {searching ? "搜索中..." : "搜索"}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                找到 {searchResults.length} 条结果
              </p>
              {searchResults.map((r, i) => (
                <div
                  key={r.chunkId || i}
                  className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                      {r.title || "(无标题)"}
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
              <p className="mt-3 text-sm text-gray-400">无搜索结果</p>
            )}
        </div>

        {/* 最后更新时间 */}
        {status?.lastIndexedAt && (
          <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 text-center">
            最后索引时间: {formatTime(status.lastIndexedAt)}
          </p>
        )}
      </div>
    </div>
  );
}
