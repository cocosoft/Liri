import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "../../stores/agentStore";
import type { AgentTaskTemplate } from "../../types";
import { SkeletonCard } from "../common/Skeleton";

function TaskCenterPage() {
  const {
    tasks: agentTasks,
    isLoading: isAgentLoading,
    error: agentError,
    taskLogs,
    selectedTask,
    loadTasks: loadAgentTasks,
    executeTask: executeAgentTask,
    cancelTask: cancelAgentTask,
    getTaskProgress: getAgentTaskProgress,
    createTask: createAgentTask,
    updateTask: updateAgentTask,
    deleteTask: deleteAgentTask,
    selectTask: selectAgentTask,
  } = useAgentStore();

  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [agentStatusFilter, setAgentStatusFilter] = useState<
    "all" | "pending" | "running" | "completed" | "failed"
  >("all");
  const [selectedAgentTaskIds, setSelectedAgentTaskIds] = useState<string[]>(
    [],
  );
  const [agentSortBy, setAgentSortBy] = useState<
    "created_at" | "name" | "priority"
  >("created_at");
  const [agentSortOrder, setAgentSortOrder] = useState<"asc" | "desc">("desc");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<(typeof agentTasks)[0] | null>(
    null,
  );
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [newTaskForm, setNewTaskForm] = useState({
    name: "",
    description: "",
    prompt: "",
    tags: [] as string[],
    priority: "medium" as "high" | "medium" | "low",
    scheduleEnabled: false,
    scheduleType: "cron" as "cron" | "interval" | "once",
    cronExpression: "",
    intervalMinutes: 60,
    scheduledTime: "",
  });
  const [editTaskForm, setEditTaskForm] = useState({
    name: "",
    description: "",
    tags: [] as string[],
    priority: "medium" as "high" | "medium" | "low",
  });
  const [tagInput, setTagInput] = useState("");
  const [templates, setTemplates] = useState<AgentTaskTemplate[]>([]);
  const [newTemplateForm, setNewTemplateForm] = useState({
    name: "",
    description: "",
    prompt: "",
    priority: "medium" as "high" | "medium" | "low",
    tags: [] as string[],
  });
  const [templateTagInput, setTemplateTagInput] = useState("");

  const expandedPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DRAFT_KEY = "agent-task-draft";
  const DRAFT_SAVE_DELAY_MS = 400;

  const filteredAgentTasks = agentTasks
    .filter((task) => {
      const matchesSearch =
        !agentSearchQuery ||
        task.name.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
        task.description
          ?.toLowerCase()
          .includes(agentSearchQuery.toLowerCase());
      const matchesStatus =
        agentStatusFilter === "all" || task.status === agentStatusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const multiplier = agentSortOrder === "asc" ? 1 : -1;
      if (agentSortBy === "name") {
        return multiplier * (a.name || "").localeCompare(b.name || "");
      }
      if (agentSortBy === "priority") {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const aP = priorityOrder[a.priority || "medium"] ?? 1;
        const bP = priorityOrder[b.priority || "medium"] ?? 1;
        return multiplier * (aP - bP);
      }
      return multiplier * ((a.created_at || 0) - (b.created_at || 0));
    });

  const isAllAgentSelected =
    filteredAgentTasks.length > 0 &&
    filteredAgentTasks.every((task) => selectedAgentTaskIds.includes(task.id));

  const saveDraft = (form: typeof newTaskForm) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch (e) {
      console.warn("Failed to save draft:", e);
    }
  };

  const loadDraft = (): typeof newTaskForm => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        return {
          ...draft,
          priority: draft.priority || "medium",
          scheduleEnabled: draft.scheduleEnabled || false,
          scheduleType: draft.scheduleType || "cron",
          cronExpression: draft.cronExpression || "",
          intervalMinutes: draft.intervalMinutes || 60,
          scheduledTime: draft.scheduledTime || "",
        };
      }
    } catch (e) {
      console.warn("Failed to load draft:", e);
    }
    return {
      name: "",
      description: "",
      prompt: "",
      tags: [],
      priority: "medium",
      scheduleEnabled: false,
      scheduleType: "cron",
      cronExpression: "",
      intervalMinutes: 60,
      scheduledTime: "",
    };
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn("Failed to clear draft:", e);
    }
  };

  const debouncedSaveDraft = (form: typeof newTaskForm) => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = setTimeout(() => {
      saveDraft(form);
    }, DRAFT_SAVE_DELAY_MS);
  };

  const showNotification = (
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  interface FormWithTags {
    tags: string[];
  }

  const addTag = <T extends FormWithTags>(
    form: T,
    setForm: (updater: (prev: T) => T) => void,
    tag: string,
  ) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !form.tags.includes(trimmedTag)) {
      setForm((prev: T) => ({ ...prev, tags: [...prev.tags, trimmedTag] }));
    }
  };

  const removeTag = <T extends FormWithTags>(
    _form: T,
    setForm: (updater: (prev: T) => T) => void,
    tag: string,
  ) => {
    setForm((prev: T) => ({
      ...prev,
      tags: prev.tags.filter((t: string) => t !== tag),
    }));
  };

  const loadTemplates = () => {
    const saved = localStorage.getItem("agent-task-templates");
    if (saved) {
      try {
        setTemplates(JSON.parse(saved));
      } catch {
        setTemplates([]);
      }
    }
  };

  const saveTemplates = (newTemplates: AgentTaskTemplate[]) => {
    localStorage.setItem("agent-task-templates", JSON.stringify(newTemplates));
    setTemplates(newTemplates);
  };

  const createTemplate = () => {
    if (!newTemplateForm.name.trim() || !newTemplateForm.prompt.trim()) return;

    const template: AgentTaskTemplate = {
      id: Date.now().toString(),
      name: newTemplateForm.name.trim(),
      description: newTemplateForm.description.trim() || undefined,
      prompt: newTemplateForm.prompt.trim(),
      priority: newTemplateForm.priority,
      tags: newTemplateForm.tags,
      createdAt: Date.now(),
    };

    saveTemplates([template, ...templates]);
    setNewTemplateForm({
      name: "",
      description: "",
      prompt: "",
      priority: "medium",
      tags: [],
    });
    setShowTemplateModal(false);
  };

  const applyTemplate = (template: AgentTaskTemplate) => {
    setNewTaskForm({
      name: template.name,
      description: template.description || "",
      prompt: template.prompt,
      priority: template.priority || "medium",
      tags: [...(template.tags || [])],
      scheduleEnabled: false,
      scheduleType: "cron",
      cronExpression: "",
      intervalMinutes: 60,
      scheduledTime: "",
    });
    setShowTemplateModal(false);
    setShowCreateModal(true);
  };

  const deleteTemplate = (templateId: string) => {
    if (confirm("确定要删除这个模板吗？")) {
      saveTemplates(templates.filter((t) => t.id !== templateId));
    }
  };

  const addTemplateTag = () => {
    const trimmedTag = templateTagInput.trim();
    if (trimmedTag && !newTemplateForm.tags.includes(trimmedTag)) {
      setNewTemplateForm((prev) => ({
        ...prev,
        tags: [...prev.tags, trimmedTag],
      }));
    }
    setTemplateTagInput("");
  };

  const removeTemplateTag = (tag: string) => {
    setNewTemplateForm((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  useEffect(() => {
    const draft = loadDraft();
    if (draft.name || draft.description || draft.prompt) {
      const shouldRestore =
        window.confirm("检测到未完成的任务草稿，是否恢复？");
      if (shouldRestore) {
        setNewTaskForm(draft);
      }
    }
    loadTemplates();
  }, []);

  useEffect(() => {
    if (showCreateModal) {
      debouncedSaveDraft(newTaskForm);
    }
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [newTaskForm, showCreateModal]);

  const toggleSelectAllAgents = () => {
    if (isAllAgentSelected) {
      setSelectedAgentTaskIds([]);
    } else {
      setSelectedAgentTaskIds(filteredAgentTasks.map((task) => task.id));
    }
  };

  const toggleSelectAgentTask = (taskId: string) => {
    setSelectedAgentTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );
  };

  const handleAgentBatchDelete = async () => {
    if (selectedAgentTaskIds.length === 0) return;
    if (
      !confirm(
        `确定要删除选中的 ${selectedAgentTaskIds.length} 个Agent任务吗？`,
      )
    )
      return;

    try {
      for (const id of selectedAgentTaskIds) {
        await deleteAgentTask(id);
      }
      setSelectedAgentTaskIds([]);
      showNotification(
        `成功删除 ${selectedAgentTaskIds.length} 个Agent任务`,
        "success",
      );
    } catch (e) {
      showNotification("删除Agent任务失败", "error");
    }
  };

  const handleAgentBatchExecute = async () => {
    if (selectedAgentTaskIds.length === 0) return;
    const completedTasks = agentTasks.filter(
      (task) =>
        selectedAgentTaskIds.includes(task.id) && task.status === "completed",
    );

    if (completedTasks.length === 0) {
      showNotification("没有可重新执行的已完成Agent任务", "info");
      return;
    }

    try {
      for (const task of completedTasks) {
        await executeAgentTask(task.name);
      }
      setSelectedAgentTaskIds([]);
      showNotification(
        `已重新执行 ${completedTasks.length} 个Agent任务`,
        "success",
      );
    } catch (e) {
      showNotification("重新执行Agent任务失败", "error");
    }
  };

  useEffect(() => {
    loadAgentTasks();
    const interval = setInterval(() => {
      loadAgentTasks();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (expandedPollRef.current) {
      clearInterval(expandedPollRef.current);
      expandedPollRef.current = null;
    }
    if (selectedTask) {
      getAgentTaskProgress(selectedTask.id);
      if (selectedTask.status === "running") {
        expandedPollRef.current = setInterval(() => {
          getAgentTaskProgress(selectedTask.id);
        }, 2000);
      }
    }
    return () => {
      if (expandedPollRef.current) {
        clearTimeout(expandedPollRef.current);
      }
    };
  }, [selectedTask]);

  const handleCreateAgentTask = async () => {
    if (!newTaskForm.name.trim()) return;
    if (isSubmitting) return;

    const scheduleConfig = newTaskForm.scheduleEnabled
      ? {
          type: newTaskForm.scheduleType,
          cronExpression:
            newTaskForm.scheduleType === "cron"
              ? newTaskForm.cronExpression
              : undefined,
          intervalMinutes:
            newTaskForm.scheduleType === "interval"
              ? newTaskForm.intervalMinutes
              : undefined,
          scheduledTime:
            newTaskForm.scheduleType === "once"
              ? newTaskForm.scheduledTime
              : undefined,
          enabled: true,
        }
      : undefined;

    setIsSubmitting(true);
    try {
      await createAgentTask({
        name: newTaskForm.name.trim(),
        description: newTaskForm.description.trim(),
        prompt: newTaskForm.prompt.trim(),
        priority: newTaskForm.priority,
        metadata: { tags: newTaskForm.tags, scheduleConfig },
      });
      setNewTaskForm({
        name: "",
        description: "",
        prompt: "",
        tags: [],
        priority: "medium",
        scheduleEnabled: false,
        scheduleType: "cron",
        cronExpression: "",
        intervalMinutes: 60,
        scheduledTime: "",
      });
      clearDraft();
      setShowCreateModal(false);
      showNotification("Agent任务创建成功", "success");
    } catch (e) {
      showNotification("创建Agent任务失败", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditModal = (task: (typeof agentTasks)[0]) => {
    setEditingTask(task);
    setEditTaskForm({
      name: task.name,
      description: task.description || "",
      tags:
        ((task.metadata as Record<string, unknown>)?.tags as string[]) || [],
      priority: task.priority || "medium",
    });
    setShowEditModal(true);
  };

  const handleUpdateAgentTask = async () => {
    if (!editingTask) return;
    await updateAgentTask(editingTask.id, {
      name: editTaskForm.name.trim(),
      description: editTaskForm.description.trim(),
    });
    setShowEditModal(false);
    setEditingTask(null);
  };

  const handleExecuteAgentTask = async (taskName: string) => {
    try {
      await executeAgentTask(taskName);
      await loadAgentTasks();
      showNotification(`任务 "${taskName}" 已开始执行`, "success");
    } catch (e) {
      showNotification(`执行任务 "${taskName}" 失败`, "error");
    }
  };

  const agentStatusColor: Record<string, string> = {
    pending:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  const agentStatusText: Record<string, string> = {
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
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
            任务中心
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded"
            >
              模板管理
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              新建 Agent 任务
            </button>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            {agentError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
                {agentError}
              </div>
            )}

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
                      {agentTasks.length}
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
                      已完成
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {
                        agentTasks.filter((t) => t.status === "completed")
                          .length
                      }
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
                      运行中
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {agentTasks.filter((t) => t.status === "running").length}
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
                      失败
                    </p>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                      {agentTasks.filter((t) => t.status === "failed").length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {selectedAgentTaskIds.length > 0 && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    已选择 <strong>{selectedAgentTaskIds.length}</strong>{" "}
                    个Agent任务
                  </span>
                  <button
                    onClick={() => setSelectedAgentTaskIds([])}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    取消选择
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAgentBatchExecute}
                    className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
                  >
                    重新执行
                  </button>
                  <button
                    onClick={handleAgentBatchDelete}
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
                  checked={isAllAgentSelected}
                  onChange={toggleSelectAllAgents}
                  disabled={filteredAgentTasks.length === 0}
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
                      placeholder="搜索Agent任务..."
                      value={agentSearchQuery}
                      onChange={(e) => setAgentSearchQuery(e.target.value)}
                      className="w-full sm:w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={agentStatusFilter}
                  onChange={(e) => setAgentStatusFilter(e.target.value as any)}
                  className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                >
                  <option value="all">全部状态</option>
                  <option value="pending">等待中</option>
                  <option value="running">运行中</option>
                  <option value="completed">已完成</option>
                  <option value="failed">失败</option>
                </select>
                <select
                  value={agentSortBy}
                  onChange={(e) =>
                    setAgentSortBy(
                      e.target.value as "created_at" | "name" | "priority",
                    )
                  }
                  className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                >
                  <option value="created_at">创建时间</option>
                  <option value="name">名称</option>
                  <option value="priority">优先级</option>
                </select>
                <button
                  onClick={() =>
                    setAgentSortOrder(agentSortOrder === "asc" ? "desc" : "asc")
                  }
                  className="px-2 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  title={agentSortOrder === "asc" ? "升序 ↑" : "降序 ↓"}
                >
                  {agentSortOrder === "asc" ? "↑" : "↓"}
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  共 {filteredAgentTasks.length} 个Agent任务
                </span>
                <button
                  onClick={loadAgentTasks}
                  disabled={isAgentLoading}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
                >
                  刷新
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {isAgentLoading && filteredAgentTasks.length === 0 ? (
                <div className="p-4 space-y-3">
                  <SkeletonCard count={3} />
                </div>
              ) : filteredAgentTasks.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  暂无匹配的Agent任务
                  <p className="text-sm mt-2">尝试调整搜索关键词或筛选条件</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {filteredAgentTasks.map((task) => (
                    <li
                      key={task.id}
                      className={`group px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                        selectedAgentTaskIds.includes(task.id)
                          ? "ring-2 ring-blue-500"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedAgentTaskIds.includes(task.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleSelectAgentTask(task.id);
                            }}
                            className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${agentStatusColor[task.status] || ""}`}
                              >
                                {agentStatusText[task.status] || task.status}
                              </span>
                              {task.priority && (
                                <span
                                  className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                                    task.priority === "high"
                                      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                                      : task.priority === "medium"
                                        ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                                        : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                                  }`}
                                >
                                  {task.priority === "high"
                                    ? "高"
                                    : task.priority === "medium"
                                      ? "中"
                                      : "低"}
                                </span>
                              )}
                              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {task.name || task.type || "未知任务"}
                              </h3>
                            </div>
                            {task.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                {task.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {task.status === "pending" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExecuteAgentTask(task.name);
                                }}
                                className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"
                                title="执行"
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
                                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0"
                                  />
                                </svg>
                              </button>
                            )}
                            {(task.status === "completed" ||
                              task.status === "failed") && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExecuteAgentTask(task.name);
                                }}
                                className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded"
                                title="重新执行"
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
                            )}
                            {task.status === "running" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelAgentTask(task.id);
                                }}
                                className="p-1.5 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded"
                                title="取消"
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
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditModal(task);
                              }}
                              className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                              title="编辑"
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
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("确定要删除这个Agent任务吗？")) {
                                  deleteAgentTask(task.id);
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
                          {task.status === "running" && (
                            <div className="flex items-center gap-2 mr-2">
                              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                              {task.progress !== undefined && (
                                <span className="text-xs text-blue-600 dark:text-blue-400">
                                  {task.progress}%
                                </span>
                              )}
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              selectAgentTask(task);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
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
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {task.status === "failed" && task.error && (
                        <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                          <div className="p-3 bg-red-50 dark:bg-red-900/30 rounded">
                            <span className="text-xs font-medium text-red-600 dark:text-red-400">
                              错误信息
                            </span>
                            <pre className="mt-1 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                              {task.error}
                            </pre>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {selectedTask && (
            <div className="w-80 shrink-0">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    任务详情
                  </h3>
                  <button
                    onClick={() => selectAgentTask(null as any)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
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
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      基本信息
                    </h4>
                    <div className="space-y-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {selectedTask.name}
                        </p>
                      </div>
                      {selectedTask.description && (
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                            {selectedTask.description}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${agentStatusColor[selectedTask.status] || ""}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${selectedTask.status === "running" ? "bg-blue-400 animate-pulse" : selectedTask.status === "completed" ? "bg-green-400" : selectedTask.status === "failed" ? "bg-red-400" : "bg-gray-400"}`}
                          />
                          {agentStatusText[selectedTask.status] ||
                            selectedTask.status}
                        </span>
                        {selectedTask.priority && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              selectedTask.priority === "high"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : selectedTask.priority === "medium"
                                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                            }`}
                          >
                            {selectedTask.priority === "high"
                              ? "高优先级"
                              : selectedTask.priority === "medium"
                                ? "中优先级"
                                : "低优先级"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 dark:border-gray-700" />

                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      时间信息
                    </h4>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          创建时间
                        </span>
                        <span className="text-xs text-gray-700 dark:text-gray-300">
                          {formatTimestamp(selectedTask.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 dark:border-gray-700" />

                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      资源消耗
                    </h4>
                    <div className="space-y-2">
                      {selectedTask.tokenUsed !== undefined && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Token 消耗
                          </span>
                          <span className="text-xs font-mono text-gray-700 dark:text-gray-300">
                            {selectedTask.tokenUsed}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {taskLogs.length > 0 && (
                    <>
                      <div className="border-t border-gray-100 dark:border-gray-700" />
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                          执行日志
                        </h4>
                        <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-auto max-h-48 font-mono bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-100 dark:border-gray-700">
                          {taskLogs.join("\n")}
                        </pre>
                      </div>
                    </>
                  )}

                  <div className="border-t border-gray-100 dark:border-gray-700" />

                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      快捷操作
                    </h4>
                    <div className="space-y-1.5">
                      {selectedTask.status === "pending" && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-blue-500">▶</span>{" "}
                          点击执行按钮开始任务
                        </p>
                      )}
                      {selectedTask.status === "running" && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-orange-500">⏸</span>{" "}
                          点击取消按钮中止任务
                        </p>
                      )}
                      {selectedTask.status === "completed" && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-green-500">✓</span>{" "}
                          任务已完成，可重新执行
                        </p>
                      )}
                      {selectedTask.status === "failed" && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <span className="text-red-500">✗</span>{" "}
                          任务失败，可重新执行
                        </p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span className="text-gray-400">✎</span>{" "}
                        点击编辑按钮修改任务
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span className="text-gray-400">🗑</span>{" "}
                        点击删除按钮移除任务
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {showCreateModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowCreateModal(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                  新建 Agent 任务
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      任务名称 *
                    </label>
                    <input
                      type="text"
                      value={newTaskForm.name}
                      onChange={(e) =>
                        setNewTaskForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      placeholder="输入任务名称"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      描述
                    </label>
                    <textarea
                      value={newTaskForm.description}
                      onChange={(e) =>
                        setNewTaskForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                      placeholder="输入任务描述"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      提示词
                    </label>
                    <textarea
                      value={newTaskForm.prompt}
                      onChange={(e) =>
                        setNewTaskForm((prev) => ({
                          ...prev,
                          prompt: e.target.value,
                        }))
                      }
                      rows={4}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                      placeholder="输入任务提示词"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      优先级
                    </label>
                    <select
                      value={newTaskForm.priority}
                      onChange={(e) =>
                        setNewTaskForm((prev) => ({
                          ...prev,
                          priority: e.target.value as "high" | "medium" | "low",
                        }))
                      }
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      标签
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTag(newTaskForm, setNewTaskForm, tagInput);
                            setTagInput("");
                          }
                        }}
                        className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        placeholder="输入标签后按回车"
                      />
                      <button
                        onClick={() => {
                          addTag(newTaskForm, setNewTaskForm, tagInput);
                          setTagInput("");
                        }}
                        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                      >
                        添加
                      </button>
                    </div>
                    {newTaskForm.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {newTaskForm.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                          >
                            {tag}
                            <button
                              onClick={() =>
                                removeTag(newTaskForm, setNewTaskForm, tag)
                              }
                              className="text-blue-400 hover:text-blue-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newTaskForm.scheduleEnabled}
                        onChange={(e) =>
                          setNewTaskForm((prev) => ({
                            ...prev,
                            scheduleEnabled: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        启用定时执行
                      </span>
                    </label>
                  </div>
                  {newTaskForm.scheduleEnabled && (
                    <div className="pl-6 space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          定时类型
                        </label>
                        <select
                          value={newTaskForm.scheduleType}
                          onChange={(e) =>
                            setNewTaskForm((prev) => ({
                              ...prev,
                              scheduleType: e.target.value as
                                | "cron"
                                | "interval"
                                | "once",
                            }))
                          }
                          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        >
                          <option value="cron">Cron 表达式</option>
                          <option value="interval">固定间隔</option>
                          <option value="once">单次定时</option>
                        </select>
                      </div>
                      {newTaskForm.scheduleType === "cron" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Cron 表达式
                          </label>
                          <input
                            type="text"
                            value={newTaskForm.cronExpression}
                            onChange={(e) =>
                              setNewTaskForm((prev) => ({
                                ...prev,
                                cronExpression: e.target.value,
                              }))
                            }
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 font-mono"
                            placeholder="*/5 * * * *"
                          />
                        </div>
                      )}
                      {newTaskForm.scheduleType === "interval" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            间隔（分钟）
                          </label>
                          <input
                            type="number"
                            value={newTaskForm.intervalMinutes}
                            onChange={(e) =>
                              setNewTaskForm((prev) => ({
                                ...prev,
                                intervalMinutes: parseInt(e.target.value) || 60,
                              }))
                            }
                            min={1}
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                      )}
                      {newTaskForm.scheduleType === "once" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            执行时间
                          </label>
                          <input
                            type="datetime-local"
                            value={newTaskForm.scheduledTime}
                            onChange={(e) =>
                              setNewTaskForm((prev) => ({
                                ...prev,
                                scheduledTime: e.target.value,
                              }))
                            }
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateAgentTask}
                    disabled={!newTaskForm.name.trim() || isSubmitting}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    创建
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showEditModal && editingTask && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowEditModal(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                  编辑 Agent 任务
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      任务名称
                    </label>
                    <input
                      type="text"
                      value={editTaskForm.name}
                      onChange={(e) =>
                        setEditTaskForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      描述
                    </label>
                    <textarea
                      value={editTaskForm.description}
                      onChange={(e) =>
                        setEditTaskForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      rows={3}
                      className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleUpdateAgentTask}
                    disabled={!editTaskForm.name.trim()}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showTemplateModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowTemplateModal(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                  任务模板管理
                </h3>

                <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    新建模板
                  </h4>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={newTemplateForm.name}
                        onChange={(e) =>
                          setNewTemplateForm((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="模板名称"
                        className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      />
                      <select
                        value={newTemplateForm.priority}
                        onChange={(e) =>
                          setNewTemplateForm((prev) => ({
                            ...prev,
                            priority: e.target.value as
                              | "high"
                              | "medium"
                              | "low",
                          }))
                        }
                        className="px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      >
                        <option value="high">高优先级</option>
                        <option value="medium">中优先级</option>
                        <option value="low">低优先级</option>
                      </select>
                    </div>
                    <textarea
                      value={newTemplateForm.description}
                      onChange={(e) =>
                        setNewTemplateForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      placeholder="模板描述（可选）"
                      rows={2}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                    />
                    <textarea
                      value={newTemplateForm.prompt}
                      onChange={(e) =>
                        setNewTemplateForm((prev) => ({
                          ...prev,
                          prompt: e.target.value,
                        }))
                      }
                      placeholder="提示词内容 *"
                      rows={3}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 resize-none"
                    />
                    <div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={templateTagInput}
                          onChange={(e) => setTemplateTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addTemplateTag();
                            }
                          }}
                          placeholder="标签"
                          className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        />
                        <button
                          onClick={addTemplateTag}
                          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                        >
                          添加
                        </button>
                      </div>
                      {newTemplateForm.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {newTemplateForm.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded"
                            >
                              {tag}
                              <button
                                onClick={() => removeTemplateTag(tag)}
                                className="text-blue-400 hover:text-blue-600"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={createTemplate}
                      disabled={
                        !newTemplateForm.name.trim() ||
                        !newTemplateForm.prompt.trim()
                      }
                      className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      创建模板
                    </button>
                  </div>
                </div>

                {templates.length > 0 ? (
                  <div className="space-y-3">
                    {templates.map((template) => (
                      <div
                        key={template.id}
                        className="p-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {template.name}
                            </h4>
                            {template.priority && (
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  template.priority === "high"
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                    : template.priority === "medium"
                                      ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                      : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                }`}
                              >
                                {template.priority === "high"
                                  ? "高"
                                  : template.priority === "medium"
                                    ? "中"
                                    : "低"}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => applyTemplate(template)}
                              className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                            >
                              使用
                            </button>
                            <button
                              onClick={() => deleteTemplate(template.id)}
                              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                        {template.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            {template.description}
                          </p>
                        )}
                        {template.prompt && (
                          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded max-h-32 overflow-y-auto">
                            {template.prompt}
                          </pre>
                        )}
                        {template.tags && template.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {template.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                    暂无模板，请创建新模板
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskCenterPage;
