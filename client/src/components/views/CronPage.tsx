import { useEffect, useState } from "react";
import { useCronStore } from "../../stores/cronStore";
import { SkeletonCard } from "../common/Skeleton";
import CronExecutionHistory from "../Cron/CronExecutionHistory";
import CronRetryConfig from "../Cron/CronRetryConfig";

function CronPage() {
  const {
    tasks,
    isLoading,
    loadTasks,
    toggleTask,
    deleteTask,
    runTaskNow,
    createTask,
  } = useCronStore();

  const [activeTab, setActiveTab] = useState<"tasks" | "history" | "retry">(
    "tasks",
  );
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "running" | "idle" | "error"
  >("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"lastRun" | "name" | "nextRun">(
    "lastRun",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newCronForm, setNewCronForm] = useState({
    name: "",
    expression: "",
    description: "",
    enabled: true,
  });
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  const showNotification = (
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const filteredTasks = tasks
    .filter((task) => {
      const matchesSearch =
        !searchQuery ||
        task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || task.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const multiplier = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "name") {
        return multiplier * (a.name || "").localeCompare(b.name || "");
      }
      if (sortBy === "nextRun") {
        return multiplier * ((a.nextRun || 0) - (b.nextRun || 0));
      }
      return multiplier * ((a.lastRun || 0) - (b.lastRun || 0));
    });

  const isAllSelected =
    filteredTasks.length > 0 &&
    filteredTasks.every((task) => selectedTaskIds.includes(task.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(filteredTasks.map((task) => task.id));
    }
  };

  const toggleSelectTask = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
  };

  const handleBatchExecute = async () => {
    if (selectedTaskIds.length === 0) return;
    try {
      for (const id of selectedTaskIds) {
        await runTaskNow(id);
      }
      setSelectedTaskIds([]);
      showNotification(
        `已手动执行 ${selectedTaskIds.length} 个定时任务`,
        "success",
      );
    } catch {
      showNotification("执行定时任务失败", "error");
    }
  };

  const handleBatchDelete = async () => {
    if (selectedTaskIds.length === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedTaskIds.length} 个定时任务吗？`))
      return;
    try {
      for (const id of selectedTaskIds) {
        await deleteTask(id);
      }
      setSelectedTaskIds([]);
      showNotification(
        `成功删除 ${selectedTaskIds.length} 个定时任务`,
        "success",
      );
    } catch {
      showNotification("删除定时任务失败", "error");
    }
  };

  const handleCreateCronTask = async () => {
    if (!newCronForm.name.trim() || !newCronForm.expression.trim()) {
      showNotification("请填写任务名称和 Cron 表达式", "info");
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await createTask({
        name: newCronForm.name.trim(),
        expression: newCronForm.expression.trim(),
        description: newCronForm.description.trim(),
        enabled: newCronForm.enabled,
      });
      setShowCreateModal(false);
      setNewCronForm({
        name: "",
        expression: "",
        description: "",
        enabled: true,
      });
      showNotification("定时任务创建成功", "success");
    } catch {
      showNotification("创建定时任务失败", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusColor: Record<string, string> = {
    running:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    idle: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
  };

  const statusText: Record<string, string> = {
    running: "运行中",
    error: "错误",
    idle: "空闲",
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN");
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            notification.type === "success"
              ? "bg-green-500 text-white"
              : notification.type === "error"
                ? "bg-red-500 text-white"
                : "bg-blue-500 text-white"
          }`}
        >
          {notification.message}
        </div>
      )}

      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            定时任务
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            新建任务
          </button>
        </div>

        <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "tasks"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            任务列表
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "history"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            执行历史
          </button>
          <button
            onClick={() => setActiveTab("retry")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "retry"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            重试配置
          </button>
        </div>

        {activeTab === "tasks" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-blue-600 dark:text-blue-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      总任务
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {tasks.length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-green-600 dark:text-green-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      运行中
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {tasks.filter((t) => t.status === "running").length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-yellow-600 dark:text-yellow-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      空闲
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {tasks.filter((t) => t.status === "idle").length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-red-600 dark:text-red-400"
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
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      错误
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {tasks.filter((t) => t.status === "error").length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {selectedTaskIds.length > 0 && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    已选择 <strong>{selectedTaskIds.length}</strong> 个定时任务
                  </span>
                  <button
                    onClick={() => setSelectedTaskIds([])}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    取消选择
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBatchExecute}
                    className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
                  >
                    立即执行
                  </button>
                  <button
                    onClick={handleBatchDelete}
                    className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
                  >
                    批量删除
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  disabled={filteredTasks.length === 0}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex-1 w-full sm:w-auto">
                  <div className="relative">
                    <svg
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0"
                      />
                    </svg>
                    <input
                      type="text"
                      placeholder="搜索定时任务..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full sm:w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                >
                  <option value="all">全部状态</option>
                  <option value="running">运行中</option>
                  <option value="idle">空闲</option>
                  <option value="error">错误</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as "lastRun" | "name" | "nextRun")
                  }
                  className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                >
                  <option value="lastRun">上次执行</option>
                  <option value="name">名称</option>
                  <option value="nextRun">下次执行</option>
                </select>
                <button
                  onClick={() =>
                    setSortOrder(sortOrder === "asc" ? "desc" : "asc")
                  }
                  className="px-2 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  title={sortOrder === "asc" ? "升序 ↑" : "降序 ↓"}
                >
                  {sortOrder === "asc" ? "↑" : "↓"}
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  共 {filteredTasks.length} 个任务
                </span>
                <button
                  onClick={loadTasks}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
                >
                  刷新
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {isLoading && filteredTasks.length === 0 ? (
                <div className="p-4 space-y-3">
                  <SkeletonCard count={3} />
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  暂无匹配的定时任务
                  <p className="text-sm mt-2">尝试调整搜索关键词或筛选条件</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {filteredTasks.map((task) => (
                    <li
                      key={task.id}
                      className={`group px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                        selectedTaskIds.includes(task.id)
                          ? "ring-2 ring-blue-500"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.includes(task.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleSelectTask(task.id);
                            }}
                            className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[task.status] || ""}`}
                              >
                                {statusText[task.status] || task.status}
                              </span>
                              <span
                                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                                  task.enabled
                                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                                }`}
                              >
                                {task.enabled ? "✓ 已启用" : "✗ 已禁用"}
                              </span>
                              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {task.name}
                              </h3>
                            </div>
                            {task.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                {task.description}
                              </p>
                            )}
                            {task.expression && (
                              <div className="mt-2">
                                <code className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded font-mono text-gray-600 dark:text-gray-300">
                                  {task.expression}
                                </code>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                runTaskNow(task.id);
                              }}
                              className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"
                              title="立即执行"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTask(task.id, !task.enabled);
                              }}
                              className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                              title={task.enabled ? "禁用" : "启用"}
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                {task.enabled ? (
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0"
                                  />
                                ) : (
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                  />
                                )}
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("确定要删除这个定时任务吗？")) {
                                  deleteTask(task.id);
                                }
                              }}
                              className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                              title="删除"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedTaskId(
                                expandedTaskId === task.id ? null : task.id,
                              );
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${expandedTaskId === task.id ? "rotate-180" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {expandedTaskId === task.id && (
                        <div className="mt-3 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                runTaskNow(task.id);
                              }}
                              className="text-xs px-2 py-1 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/30"
                            >
                              立即执行
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTask(task.id, !task.enabled);
                              }}
                              className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30"
                            >
                              {task.enabled ? "禁用" : "启用"}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("确定要删除这个定时任务吗？")) {
                                  deleteTask(task.id);
                                }
                              }}
                              className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              删除
                            </button>
                          </div>

                          {task.expression && (
                            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                Cron 表达式
                              </span>
                              <code className="block mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre font-mono bg-white dark:bg-gray-800 p-2 rounded">
                                {task.expression}
                              </code>
                            </div>
                          )}

                          {task.nextRun && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded">
                              <span className="text-xs font-medium text-blue-500 dark:text-blue-400">
                                下次执行时间
                              </span>
                              <p className="mt-1 text-sm text-blue-600 dark:text-blue-300">
                                {formatTimestamp(task.nextRun)}
                              </p>
                            </div>
                          )}

                          {task.lastRun && (
                            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                上次执行时间
                              </span>
                              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                                {formatTimestamp(task.lastRun)}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {activeTab === "history" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <CronExecutionHistory />
          </div>
        )}

        {activeTab === "retry" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <CronRetryConfig />
          </div>
        )}
      </div>

      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                新建定时任务
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    任务名称 *
                  </label>
                  <input
                    type="text"
                    value={newCronForm.name}
                    onChange={(e) =>
                      setNewCronForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    placeholder="输入定时任务名称"
                    className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Cron 表达式 *
                  </label>
                  <input
                    type="text"
                    value={newCronForm.expression}
                    onChange={(e) =>
                      setNewCronForm((prev) => ({
                        ...prev,
                        expression: e.target.value,
                      }))
                    }
                    placeholder="例如: 0 */6 * * *"
                    className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    格式: 分 时 日 月 周 (空格分隔)
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    描述
                  </label>
                  <textarea
                    value={newCronForm.description}
                    onChange={(e) =>
                      setNewCronForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="输入任务描述（可选）"
                    rows={3}
                    className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="cron-enabled"
                    checked={newCronForm.enabled}
                    onChange={(e) =>
                      setNewCronForm((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label
                    htmlFor="cron-enabled"
                    className="text-sm text-gray-700 dark:text-gray-300"
                  >
                    创建后立即启用
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewCronForm({
                      name: "",
                      expression: "",
                      description: "",
                      enabled: true,
                    });
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateCronTask}
                  disabled={
                    !newCronForm.name.trim() ||
                    !newCronForm.expression.trim() ||
                    isSubmitting
                  }
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CronPage;
