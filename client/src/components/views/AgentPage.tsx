import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { SkeletonCard } from "../common/Skeleton";

function AgentPage() {
  const {
    tasks,
    isLoading,
    error,
    taskProgress,
    loadTasks,
    executeTask,
    cancelTask,
    getTaskProgress,
  } = useAgentStore();
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const [taskName, setTaskName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopExpandedPoll = () => {
    if (expandedPollRef.current) {
      clearInterval(expandedPollRef.current);
      expandedPollRef.current = null;
    }
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 3000);
    return () => {
      clearInterval(interval);
      stopExpandedPoll();
    };
  }, []);

  useEffect(() => {
    stopExpandedPoll();
    if (expandedId) {
      getTaskProgress(expandedId);
      expandedPollRef.current = setInterval(() => {
        getTaskProgress(expandedId);
      }, 2000);
    }
    return stopExpandedPoll;
  }, [expandedId]);

  const handleExecute = async () => {
    if (!taskName.trim()) return;
    await executeTask(taskName.trim());
    setTaskName("");
  };

  const statusColor: Record<string, string> = {
    pending:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  const statusText: Record<string, string> = {
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Agent 任务
          </h2>
          <button
            onClick={() => setActivePage("chat")}
            className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
          >
            返回聊天
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleExecute()}
            placeholder="输入任务名称..."
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleExecute}
            disabled={!taskName.trim() || isLoading}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg disabled:cursor-not-allowed"
          >
            执行
          </button>
          <button
            onClick={loadTasks}
            disabled={isLoading}
            className="px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
          >
            刷新
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {isLoading && tasks.length === 0 ? (
            <div className="p-4 space-y-3">
              <SkeletonCard count={3} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              暂无任务
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {tasks.map((task) => (
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
                          statusColor[task.status] || ""
                        }`}
                      >
                        {statusText[task.status] || task.status}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {task.name || task.type || "未知任务"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {task.progress !== undefined && (
                        <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                      {(task.status === "pending" ||
                        task.status === "running") && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelTask(task.id);
                          }}
                          className="text-xs px-2 py-1 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                        >
                          取消
                        </button>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {expandedId === task.id ? "▲" : "▼"}
                      </span>
                    </div>
                  </div>

                  {expandedId === task.id && (
                    <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                      {task.result && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            结果:
                          </span>
                          <p className="mt-0.5 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {task.result}
                          </p>
                        </div>
                      )}
                      {task.error && (
                        <div>
                          <span className="text-xs font-medium text-red-500 dark:text-red-400">
                            错误:
                          </span>
                          <p className="mt-0.5 text-xs text-red-500 dark:text-red-400">
                            {task.error}
                          </p>
                        </div>
                      )}
                      {task.subTasks && task.subTasks.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            子任务 ({task.subTasks.length}):
                          </span>
                          <ul className="mt-1 space-y-1">
                            {task.subTasks.map((st, idx) => (
                              <li
                                key={idx}
                                className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    st.status === "completed"
                                      ? "bg-green-400"
                                      : st.status === "running"
                                        ? "bg-blue-400"
                                        : st.status === "failed"
                                          ? "bg-red-400"
                                          : "bg-gray-300"
                                  }`}
                                />
                                <span className="truncate">{st.name}</span>
                                {st.status === "running" &&
                                  st.progress !== undefined && (
                                    <span className="text-gray-400">
                                      {st.progress}%
                                    </span>
                                  )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {task.logs && task.logs.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            日志 ({task.logs.length}):
                          </span>
                          <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                            {task.logs.map((log, idx) => (
                              <p
                                key={idx}
                                className="text-xs text-gray-500 dark:text-gray-400 font-mono"
                              >
                                {log}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                      {expandedId === task.id &&
                        taskProgress &&
                        taskProgress.agentId === task.id && (
                          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-2">
                            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                              实时进度:
                            </span>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                  style={{ width: `${taskProgress.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                                {taskProgress.progress}%
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                              {taskProgress.message || taskProgress.state}
                            </p>
                          </div>
                        )}
                      <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 pt-1">
                        <span>
                          {new Date(task.created_at).toLocaleString("zh-CN")}
                        </span>
                        {task.tokenUsed !== undefined && (
                          <span>Token: {task.tokenUsed}</span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentPage;
