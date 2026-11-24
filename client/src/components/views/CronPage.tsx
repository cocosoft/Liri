import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCronStore } from "../../stores/cronStore";
import { useOnceOnMount } from "../../hooks/useOnceOnMount";
import { SkeletonCard } from "../common/Skeleton";
import CronExecutionHistory from "../Cron/CronExecutionHistory";
import CronRetryConfig from "../Cron/CronRetryConfig";
import RunningTasksCard from "../RunningTasksCard";
import CronStatsGrid from "./cron/CronStatsGrid";
import CronSchedulerStatusBar from "./cron/CronSchedulerStatusBar";
import CronQuickTemplates, {
  type CronQuickTemplate,
} from "./cron/CronQuickTemplates";
import CronBatchActionBar from "./cron/CronBatchActionBar";
import CronListToolbar, {
  type CronSortBy,
  type CronStatusFilter,
} from "./cron/CronListToolbar";
import CronTaskRow from "./cron/CronTaskRow";
import CronCreateModal from "./cron/CronCreateModal";
import { createEmptyCronForm, type CronFormState } from "./cron/cronForm";

function CronPage() {
  const { t } = useTranslation();
  const {
    tasks,
    isLoading,
    saving,
    schedulerStatus,
    statusLoading,
    loadTasks,
    loadStatus,
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
  const [statusFilter, setStatusFilter] = useState<CronStatusFilter>("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<CronSortBy>("lastRun");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newCronForm, setNewCronForm] =
    useState<CronFormState>(createEmptyCronForm);
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // M15（2026-10-30）：首屏只拉一次 —— StrictMode 下 effect 双执行会各请求 2 次
  // （真机实测 `GET /v1/cron`、`GET /v1/cron/status` 各 2 次）。
  useOnceOnMount(() => {
    loadTasks();
    loadStatus();
  });
  // 每 30s 刷新调度器状态
  useEffect(() => {
    const interval = setInterval(() => {
      loadStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadStatus]);

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
        t("cron.executeSuccess", "Executed successfully"),
        "success",
      );
    } catch {
      showNotification(t("cron.executeFailed", "Execution failed"), "error");
    }
  };

  const handleBatchDelete = async () => {
    if (selectedTaskIds.length === 0) return;
    if (!confirm(t("cron.batchDeleteConfirm", "Delete selected tasks?")))
      return;
    try {
      for (const id of selectedTaskIds) {
        await deleteTask(id);
      }
      setSelectedTaskIds([]);
      showNotification(
        t("cron.deleteSuccess", "Deleted successfully"),
        "success",
      );
    } catch {
      showNotification(t("cron.deleteFailed", "Delete failed"), "error");
    }
  };

  const handleCreateCronTask = async () => {
    // Build expression from schedule mode
    let expression = newCronForm.expression.trim();
    if (newCronForm.scheduleMode === "every") {
      expression = `every ${newCronForm.everyValue}${newCronForm.everyUnit === "minutes" ? "m" : newCronForm.everyUnit === "hours" ? "h" : "d"}`;
    } else if (newCronForm.scheduleMode === "at") {
      expression = `at ${newCronForm.atHour}:${newCronForm.atMinute}`;
    }
    if (!newCronForm.name.trim() || !newCronForm.prompt.trim() || !expression) {
      showNotification(
        t(
          "cron.fillRequired",
          "Please fill in task name, execution content, and schedule",
        ),
        "info",
      );
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await createTask({
        name: newCronForm.name.trim(),
        expression,
        prompt: newCronForm.prompt.trim(),
        description: newCronForm.description.trim(),
        enabled: newCronForm.enabled,
        scheduleMode: newCronForm.scheduleMode,
        silent: newCronForm.silent,
        everyValue: newCronForm.everyValue,
        everyUnit: newCronForm.everyUnit,
        atHour: newCronForm.atHour,
        atMinute: newCronForm.atMinute,
        deliver: newCronForm.deliver,
        deliverTo: newCronForm.deliverTo,
      });
      setShowCreateModal(false);
      setNewCronForm(createEmptyCronForm());
      showNotification(
        t("cron.createSuccess", "Cron task created successfully"),
        "success",
      );
    } catch {
      showNotification(t("cron.createFailed", "Create failed"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  /** 套用预设模板 */
  const applyTemplate = (template: CronQuickTemplate) => {
    setNewCronForm((prev) => ({
      ...prev,
      scheduleMode: template.scheduleMode,
      expression: template.cronExpr ?? prev.expression,
      everyValue: template.everyValue ?? prev.everyValue,
      everyUnit: template.everyUnit ?? prev.everyUnit,
      atHour: template.atHour ?? prev.atHour,
      atMinute: template.atMinute ?? prev.atMinute,
    }));
  };

  /** 关闭新建弹窗（遮罩点击：只关闭，不重置 —— 与拆分前一致） */
  const closeCreateModal = () => {
    setShowCreateModal(false);
  };

  /** 取消新建（关闭并重置表单 —— 与拆分前一致） */
  const cancelCreateModal = () => {
    setShowCreateModal(false);
    setNewCronForm(createEmptyCronForm());
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
        {/* 运行中任务卡片（批次 4：与下方 CronStatsGrid 同源，不再自行取数） */}
        <div className="mb-4">
          <RunningTasksCard tasks={tasks} />
        </div>

        {/* 调度器状态栏 */}
        <CronSchedulerStatusBar
          status={schedulerStatus}
          loading={statusLoading}
        />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("cron.pageTitle", "定时任务")}
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving
              ? t("cron.creating", "创建中...")
              : t("cron.newTask", "新建任务")}
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
            {t("cron.tabTasks")}
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "history"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t("cron.tabHistory")}
          </button>
          <button
            onClick={() => setActiveTab("retry")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "retry"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {t("cron.tabRetry")}
          </button>
        </div>

        {activeTab === "tasks" && (
          <>
            <CronStatsGrid tasks={tasks} />

            <CronQuickTemplates
              onApply={(template) => {
                setShowCreateModal(true);
                applyTemplate(template);
              }}
            />

            {selectedTaskIds.length > 0 && (
              <CronBatchActionBar
                count={selectedTaskIds.length}
                saving={saving}
                onClear={() => setSelectedTaskIds([])}
                onExecute={handleBatchExecute}
                onDelete={handleBatchDelete}
              />
            )}

            <CronListToolbar
              isAllSelected={isAllSelected}
              allDisabled={filteredTasks.length === 0}
              onToggleSelectAll={toggleSelectAll}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              sortOrder={sortOrder}
              onToggleSortOrder={() =>
                setSortOrder(sortOrder === "asc" ? "desc" : "asc")
              }
              filteredCount={filteredTasks.length}
              isLoading={isLoading}
              onRefresh={loadTasks}
            />

            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {isLoading && filteredTasks.length === 0 ? (
                <div className="p-4 space-y-3">
                  <SkeletonCard count={3} />
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  {t("cron.noMatchingTasks", "No matching tasks")}
                  <p className="text-sm mt-2">
                    {t("cron.noMatchingDesc", "Try adjusting filters")}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {filteredTasks.map((task) => (
                    <CronTaskRow
                      key={task.id}
                      task={task}
                      selected={selectedTaskIds.includes(task.id)}
                      expanded={expandedTaskId === task.id}
                      saving={saving}
                      onToggleSelect={() => toggleSelectTask(task.id)}
                      onRunNow={() => runTaskNow(task.id)}
                      onToggleEnabled={() => toggleTask(task.id, !task.enabled)}
                      onDelete={() => deleteTask(task.id)}
                      onToggleExpand={() =>
                        setExpandedTaskId(
                          expandedTaskId === task.id ? null : task.id,
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {activeTab === "history" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <CronExecutionHistory tasks={tasks} />
          </div>
        )}

        {activeTab === "retry" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <CronRetryConfig tasks={tasks} />
          </div>
        )}
      </div>

      {showCreateModal && (
        <CronCreateModal
          form={newCronForm}
          setForm={setNewCronForm}
          submitting={isSubmitting}
          onClose={closeCreateModal}
          onCancel={cancelCreateModal}
          onSubmit={handleCreateCronTask}
        />
      )}
    </div>
  );
}

export default CronPage;
