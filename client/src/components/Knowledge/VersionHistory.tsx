/**
 * VersionHistory — 知识文档版本历史面板
 *
 * P0-4: 查看快照列表、对比版本差异、恢复历史版本
 */
import { useState, useEffect, useRef } from "react";
import { knowledgeService } from "../../services/knowledgeService";
import { toastError } from "../../stores/toastStore";

interface VersionHistoryProps {
  isDark: boolean;
  title: string;
  currentContent: string;
  /** P2-5: 恢复成功后回调恢复的内容，供上层刷新展示 */
  onRestored?: (content: string) => void;
}

function VersionHistory({
  isDark,
  title,
  currentContent,
  onRestored,
}: VersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [snapshotContent, setSnapshotContent] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [viewMode, setViewMode] = useState<"side" | "inline">("side");
  // KB-R4：快照请求序号，丢弃在飞过期响应（切文档后旧请求返回不得覆盖新文档快照）
  const loadSeqRef = useRef(0);

  const bgClass = isDark ? "bg-gray-800" : "bg-white";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const btnClass = isDark
    ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
    : "bg-gray-100 text-gray-600 hover:bg-gray-200";

  useEffect(() => {
    if (open && snapshots.length === 0) {
      loadSnapshots();
    }
  }, [open]);

  // KB-VH（2026-08-27）：切换文档时 title 变化但组件复用不重新挂载，
  // 若不重置状态会显示上一个文档的快照/选中版本
  const prevTitleRef = useRef(title);
  useEffect(() => {
    if (prevTitleRef.current === title) return;
    prevTitleRef.current = title;
    setSnapshots([]);
    setSelectedSnapshot(null);
    setSnapshotContent(null);
    setOpen(false);
  }, [title]);

  async function loadSnapshots() {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const list = await knowledgeService.listSnapshots(title);
      if (seq !== loadSeqRef.current) return; // KB-R4：过期响应丢弃
      setSnapshots(list);
    } catch {
      if (seq !== loadSeqRef.current) return;
      // KB-V1：加载失败明确提示（原静默 setSnapshots([]) 显示"历史版本 (0)"误导为无版本）
      toastError("加载版本历史失败，请稍后重试");
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectSnapshot(name: string) {
    setSelectedSnapshot(name);
    try {
      const content = await knowledgeService.getSnapshotContent(title, name);
      setSnapshotContent(content);
    } catch {
      // KB-V1：读取失败明确提示（原静默无任何反馈）
      toastError("读取快照内容失败，请稍后重试");
      setSnapshotContent(null);
    }
  }

  async function handleRestore() {
    if (!selectedSnapshot || !confirm("确定恢复到此版本？当前内容将被覆盖。"))
      return;
    setRestoring(true);
    try {
      const content = await knowledgeService.restoreSnapshot(
        title,
        selectedSnapshot,
      );
      if (content !== null) {
        setOpen(false);
        onRestored?.(content);
      } else {
        toastError(new Error("恢复失败"));
      }
    } catch (err) {
      // KB-VH（2026-08-27）：restoreSnapshot 失败时兜底提示，避免 unhandled rejection
      toastError(err instanceof Error ? err : new Error("恢复失败"));
    } finally {
      setRestoring(false);
    }
  }

  function parseSnapshotTime(name: string): string {
    // snapshot_2026-07-12T05-30-00-000Z.md → 2026-07-12 05:30:00.000
    const m = name.match(
      /snapshot_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.md$/,
    );
    if (!m) return name;
    return `${m[1]} ${m[2]}:${m[3]}:${m[4]}.${m[5]}`;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`text-xs ${btnClass} px-2 py-1 rounded transition-colors`}
        title="查看历史版本"
      >
        历史版本
      </button>
    );
  }

  return (
    <div
      className={`mt-4 rounded-lg border ${borderColor} ${bgClass} overflow-hidden`}
    >
      {/* 头部 */}
      <div
        className={`px-3 py-2 border-b ${borderColor} flex items-center justify-between`}
      >
        <span className={`text-sm font-medium ${textPrimary}`}>
          历史版本 ({snapshots.length})
        </span>
        <div className="flex items-center gap-2">
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as "side" | "inline")}
            className={`text-xs px-1.5 py-0.5 rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-300" : "bg-white border-gray-300"}`}
          >
            <option value="side">并排对比</option>
            <option value="inline">行内对比</option>
          </select>
          <button
            onClick={() => {
              setOpen(false);
              setSelectedSnapshot(null);
            }}
            className={`text-xs ${btnClass} px-2 py-0.5 rounded`}
          >
            关闭
          </button>
        </div>
      </div>

      {/* 快照列表 */}
      <div className="flex max-h-80">
        <div
          className={`w-56 border-r ${borderColor} overflow-y-auto flex-shrink-0`}
        >
          {loading && (
            <div className={`px-3 py-2 text-xs ${textSecondary}`}>
              加载中...
            </div>
          )}
          {!loading && snapshots.length === 0 && (
            <div className={`px-3 py-2 text-xs ${textSecondary}`}>
              暂无历史版本
            </div>
          )}
          {snapshots.map((name) => (
            <button
              key={name}
              onClick={() => handleSelectSnapshot(name)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                selectedSnapshot === name
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  : `${textSecondary} hover:bg-gray-50 dark:hover:bg-gray-700/50`
              }`}
            >
              {parseSnapshotTime(name)}
            </button>
          ))}
        </div>

        {/* 对比区域 */}
        <div className="flex-1 overflow-auto" style={{ maxHeight: "20rem" }}>
          {viewMode === "side" ? (
            <div
              className="grid grid-cols-2 divide-x"
              style={{ minHeight: "10rem" }}
            >
              <div className="p-2">
                <div className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">
                  旧版本
                </div>
                <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">
                  {snapshotContent || "选择左侧版本查看"}
                </pre>
              </div>
              <div className="p-2">
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                  当前版本
                </div>
                <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {currentContent}
                </pre>
              </div>
            </div>
          ) : (
            <div className="p-2">
              <div className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">
                旧版本
              </div>
              <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed mb-4">
                {snapshotContent || "选择左侧版本查看"}
              </pre>
              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                当前版本
              </div>
              <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                {currentContent}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作 */}
      {selectedSnapshot && (
        <div
          className={`px-3 py-2 border-t ${borderColor} flex items-center justify-end gap-2`}
        >
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded"
          >
            {restoring ? "恢复中..." : "恢复到此版本"}
          </button>
        </div>
      )}
    </div>
  );
}

export default VersionHistory;
