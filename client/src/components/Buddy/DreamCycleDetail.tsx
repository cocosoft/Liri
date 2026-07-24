import { useEffect, useState } from "react";
import { memoryService } from "../../services/memoryService";

interface DreamCycleDetail {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  triggerSource: string;
  status: string;
  snapshotTime: number;
  sessionsScanned: number;
  sessionsProcessed: number;
  knowledgeFilesProcessed: number;
  memoriesCreated: number;
  memoriesRefined: number;
  knowledgeFilesUpdated: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;
  processedSessionIds: string[];
  processedKnowledgeFiles: string[];
  memoryCount: number;
  insights: string[];
  errors: string[];
  soulConflicts: number;
  userConflicts: number;
}

interface DreamCycleDetailProps {
  cycleId: string;
  isDark: boolean;
  onClose: () => void;
}

function DreamCycleDetail({ cycleId, isDark, onClose }: DreamCycleDetailProps) {
  const [cycle, setCycle] = useState<DreamCycleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDetail();
  }, [cycleId]);

  const loadDetail = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await memoryService.getDreamCycle(cycleId);
      setCycle(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDuration = (startMs: number, endMs: number) => {
    const sec = Math.round((endMs - startMs) / 1000);
    if (sec < 60) return `${sec}秒`;
    const min = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    return `${min}分${remainingSec}秒`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
            已完成
          </span>
        );
      case "partial":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            部分完成
          </span>
        );
      case "failed":
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
            失败
          </span>
        );
      default:
        return null;
    }
  };

  const getTriggerLabel = (source: string) => {
    switch (source) {
      case "idle":
        return "空闲触发";
      case "cron":
        return "定时触发";
      case "manual":
        return "手动触发";
      default:
        return source;
    }
  };

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        onClick={onClose}
      >
        <div
          className={`w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl shadow-xl p-6 ${isDark ? "bg-gray-800" : "bg-white"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center py-8 text-gray-400">加载中...</div>
        </div>
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        onClick={onClose}
      >
        <div
          className={`w-full max-w-2xl rounded-xl shadow-xl p-6 ${isDark ? "bg-gray-800" : "bg-white"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center py-8 text-red-500">
            {error || "未找到记录"}
          </div>
          <div className="flex justify-center mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl max-h-[85vh] overflow-auto rounded-xl shadow-xl ${isDark ? "bg-gray-800" : "bg-white"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className={`sticky top-0 z-10 flex items-center justify-between p-4 border-b ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
        >
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              🌙 梦境周期详情
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
              {cycle.cycleId}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 基本信息 */}
          <div className="flex items-center gap-3">
            {getStatusBadge(cycle.status)}
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${isDark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-600"}`}
            >
              {getTriggerLabel(cycle.triggerSource)}
            </span>
          </div>

          {/* 时间信息 */}
          <div
            className={`grid grid-cols-3 gap-3 text-sm p-3 rounded-lg ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
          >
            <div>
              <div className="text-xs text-gray-400 mb-0.5">开始时间</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {formatTime(cycle.startedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">完成时间</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {formatTime(cycle.completedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">总耗时</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {formatDuration(cycle.startedAt, cycle.completedAt)}
              </div>
            </div>
          </div>

          {/* 处理统计 */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              📊 处理统计
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">扫描会话</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.sessionsScanned}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">深入处理</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.sessionsProcessed}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">创建记忆</div>
                <div className="font-medium text-green-600 dark:text-green-400">
                  {cycle.memoriesCreated}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">精炼记忆</div>
                <div className="font-medium text-purple-600 dark:text-purple-400">
                  {cycle.memoriesRefined}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">知识文件</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.knowledgeFilesProcessed}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">知识更新</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.knowledgeFilesUpdated}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">记忆总数</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {cycle.memoryCount}
                </div>
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">快照时间</div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {formatTime(cycle.snapshotTime)}
                </div>
              </div>
            </div>
          </div>

          {/* SOUL/USER 纠偏 */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              🧠 人格纠偏
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">SOUL.md</div>
                <div
                  className={`font-medium mt-0.5 ${cycle.soulUpdated ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}
                >
                  {cycle.soulUpdated ? "已更新" : "未变更"}
                </div>
                {cycle.soulConflicts > 0 && (
                  <div className="text-amber-500 mt-0.5">
                    {cycle.soulConflicts} 次乐观锁冲突
                  </div>
                )}
              </div>
              <div
                className={`p-2 rounded ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                <div className="text-gray-400">USER.md</div>
                <div
                  className={`font-medium mt-0.5 ${cycle.userProfileUpdated ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`}
                >
                  {cycle.userProfileUpdated ? "已更新" : "未变更"}
                </div>
                {cycle.userConflicts > 0 && (
                  <div className="text-amber-500 mt-0.5">
                    {cycle.userConflicts} 次乐观锁冲突
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 已处理的会话 */}
          {cycle.processedSessionIds.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                📋 已凝练的会话 ({cycle.processedSessionIds.length})
              </h3>
              <div
                className={`max-h-32 overflow-auto rounded-lg p-2 ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                {cycle.processedSessionIds.map((id) => (
                  <div
                    key={id}
                    className="text-xs text-gray-500 dark:text-gray-400 py-0.5 font-mono"
                  >
                    {id}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 已处理的知识文件 */}
          {cycle.processedKnowledgeFiles.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                📄 已处理的知识文件 ({cycle.processedKnowledgeFiles.length})
              </h3>
              <div
                className={`max-h-32 overflow-auto rounded-lg p-2 ${isDark ? "bg-gray-700" : "bg-gray-50"}`}
              >
                {cycle.processedKnowledgeFiles.map((file) => (
                  <div
                    key={file}
                    className="text-xs text-gray-500 dark:text-gray-400 py-0.5"
                  >
                    {file}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 洞察列表 */}
          {cycle.insights.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                💡 洞察
              </h3>
              <ul className="space-y-1">
                {cycle.insights.map((insight, i) => (
                  <li
                    key={i}
                    className={`text-sm pl-4 relative before:content-['•'] before:absolute before:left-1 ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 错误列表 */}
          {cycle.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-500 dark:text-red-400 mb-2">
                ⚠️ 错误
              </h3>
              <ul className="space-y-1">
                {cycle.errors.map((err, i) => (
                  <li
                    key={i}
                    className="text-sm text-red-600 dark:text-red-400 pl-4 relative before:content-['•'] before:absolute before:left-1"
                  >
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 底部关闭按钮 */}
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${isDark ? "bg-gray-700 hover:bg-gray-600 text-gray-200" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DreamCycleDetail;
