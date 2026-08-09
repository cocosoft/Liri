import { useEffect, useMemo, useState } from "react";
import { useAgentStore } from "../../stores/agent";
import { createLogger } from "../../utils/logger";
import { handleClientError } from "../../utils/handleError";
import type { AgentTask } from "../../types";

const logger = createLogger("AgentTaskSettings");

/** 状态 → 徽标样式（与 AgentPage 配色一致） */
const STATUS_COLOR: Record<AgentTask["status"], string> = {
  pending:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  completed:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  lost: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

/** 状态 → 中文文案 */
const STATUS_TEXT: Record<AgentTask["status"], string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  lost: "丢失",
};

type StatusFilter = AgentTask["status"] | "all";

/** 状态过滤选项 */
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "pending", label: "等待中" },
  { id: "running", label: "运行中" },
  { id: "completed", label: "已完成" },
  { id: "failed", label: "失败" },
];

/** 自动轮询间隔（跨项目全局任务进度保持最新） */
const POLL_INTERVAL_MS = 5000;

function AgentTaskSettings() {
  const {
    tasks,
    isLoading,
    error,
    loadTasks,
    cancelTask,
    deleteTask,
    executeTask,
  } = useAgentStore();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 首次加载 + 每 5s 自动轮询
  useEffect(() => {
    loadTasks();
    const iv = setInterval(loadTasks, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [loadTasks]);

  const filtered = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );

  /** 各状态计数（过滤 tab 徽标） */
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [tasks]);

  const canCancel = (status: AgentTask["status"]) =>
    status === "pending" || status === "running";
  const canRerun = (status: AgentTask["status"]) =>
    status === "completed" || status === "failed" || status === "lost";

  const handleRerun = async (task: AgentTask) => {
    if (!task.name) return;
    try {
      await executeTask(task.name);
      logger.info("任务重新执行", { taskId: task.id, taskName: task.name });
    } catch (e) {
      handleClientError(e, { module: "settings:AgentTask", action: "rerun", meta: { taskId: task.id } });
    }
  };

  const handleDelete = async (task: AgentTask) => {
    if (
      !window.confirm(`确定删除任务「${task.name || task.type || task.id}」？`)
    ) {
      return;
    }
    try {
      await deleteTask(task.id);
      logger.info("任务已删除", { taskId: task.id });
    } catch (e) {
      handleClientError(e, { module: "settings:AgentTask", action: "delete", meta: { taskId: task.id } });
    }
    if (expandedId === task.id) setExpandedId(null);
  };

  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Agent 任务管理
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          跨项目的全局 Agent 任务列表，每 5 秒自动刷新
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 状态过滤 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              filter === f.id
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {f.label}
            <span className="ml-1 text-xs opacity-70">{counts[f.id] || 0}</span>
          </button>
        ))}
        <button
          onClick={loadTasks}
          disabled={isLoading}
          className="ml-auto px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      {/* 任务列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading && filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-gray-500">
            暂无任务
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {filtered.map((task) => (
              <li key={task.id} className="px-4 py-3">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() =>
                    setExpandedId(expandedId === task.id ? null : task.id)
                  }
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                        STATUS_COLOR[task.status]
                      }`}
                    >
                      {STATUS_TEXT[task.status] || task.status}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {task.name || task.type || "未知任务"}
                    </span>
                    {task.progress !== undefined && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {task.progress}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canCancel(task.status) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelTask(task.id).catch((err: unknown) => {
                            handleClientError(err, { module: "settings:AgentTask", action: "cancel", meta: { taskId: task.id } });
                          });
                        }}
                        className="text-xs px-2 py-1 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        终止
                      </button>
                    )}
                    {canRerun(task.status) && task.name && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRerun(task);
                        }}
                        className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      >
                        重新执行
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(task);
                      }}
                      className="text-xs px-2 py-1 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      删除
                    </button>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {expandedId === task.id ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                {/* 进度条 */}
                {task.progress !== undefined && task.progress > 0 && (
                  <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                )}

                {expandedId === task.id && (
                  <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3 text-sm">
                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <span>ID: {task.id}</span>
                      <span>
                        创建时间： {new Date(task.created_at).toLocaleString()}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-gray-600 dark:text-gray-300">
                        {task.description}
                      </p>
                    )}
                    {task.result && (
                      <div>
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          结果
                        </div>
                        <pre className="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 max-h-40 overflow-y-auto">
                          {task.result}
                        </pre>
                      </div>
                    )}
                    {task.error && (
                      <div>
                        <div className="text-xs font-medium text-red-500 mb-1">
                          错误
                        </div>
                        <pre className="whitespace-pre-wrap text-xs bg-red-50 dark:bg-red-900/20 rounded p-2 text-red-600 dark:text-red-400 max-h-40 overflow-y-auto">
                          {task.error}
                        </pre>
                      </div>
                    )}
                    {task.tokenUsed !== undefined && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Token 用量: {task.tokenUsed}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AgentTaskSettings;
