import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "../../stores/agent";
import type { AgentTaskTemplate } from "../../types";
import { agentService } from "../../services/agentService";
import { httpLegacy as http } from "../../services/httpClient";
import AgentChatPanel from "../Agent/AgentChatPanel";
import PdcaPipeline from "../Agent/PdcaPipeline";
import KanbanBoard from "../Agent/KanbanBoard";
import { SkeletonCard } from "../common/Skeleton";
import PlansPanel from "./PlansPanel";
import RunningTasksCard from "../RunningTasksCard";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:taskCenter");

interface PlanItem {
  id: string;
  status: string;
  description?: string;
  steps?: PlanStep[];
}

interface PlanStep {
  id: string;
  status: string;
  description?: string;
  agent?: string;
}

interface FlowItem {
  flowId: string;
  status: string;
  goal?: string;
  ownerKey?: string;
  currentStep?: string;
}

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
    "all" | "pending" | "running" | "completed" | "failed" | "lost"
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

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pageTab, setPageTab] = useState<"tasks" | "plans">("tasks");
  const [detailTab, setDetailTab] = useState<
    "info" | "audit" | "output" | "chat" | "orchestrate"
  >("info");
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [flows, setFlows] = useState<FlowItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<
    Array<{
      taskId: string;
      eventType: string;
      oldStatus: string | null;
      newStatus: string;
      timestamp: number;
    }>
  >([]);
  const [outputContent, setOutputContent] = useState<string | null>(null);
  const [taskState, setTaskState] = useState<Record<string, unknown> | null>(
    null,
  );
  const [recoveringIds, setRecoveringIds] = useState<Set<string>>(new Set());

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
      logger.warn("Failed to save draft:", e);
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
      logger.warn("Failed to load draft:", e);
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
      logger.warn("Failed to clear draft:", e);
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
      if (autoRefresh) loadAgentTasks();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    if (expandedPollRef.current) {
      clearInterval(expandedPollRef.current);
      expandedPollRef.current = null;
    }
    setAuditLogs([]);
    setOutputContent(null);
    setTaskState(null);
    setDetailTab("info");
    if (selectedTask) {
      getAgentTaskProgress(selectedTask.id);
      agentService
        .getTaskState(selectedTask.id)
        .then((s) => setTaskState(s ?? null))
        .catch(() => {});
      agentService
        .getTaskAuditLogs(selectedTask.id)
        .then((logs) => setAuditLogs(Array.isArray(logs) ? logs : []))
        .catch(() => {});
      if (selectedTask.status === "running") {
        expandedPollRef.current = setInterval(() => {
          getAgentTaskProgress(selectedTask.id);
        }, 2000);
      }
    }
    return () => {
      if (expandedPollRef.current) {
        clearInterval(expandedPollRef.current);
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
    lost: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  };

  const agentStatusText: Record<string, string> = {
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    lost: "已失联",
  };

  const reloadOutput = async (id: string) => {
    try {
      const content = await agentService.getTaskOutput(id);
      setOutputContent(
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2),
      );
    } catch {
      setOutputContent("(无法加载输出)");
    }
  };

  const handleRecoverTask = async (id: string) => {
    setRecoveringIds((prev) => new Set(prev).add(id));
    try {
      await agentService.recoverTask(id);
      showNotification("任务已恢复为等待中", "success");
      loadAgentTasks();
    } catch {
      showNotification("恢复失败", "error");
    } finally {
      setRecoveringIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleBatchKill = async () => {
    const running = selectedAgentTaskIds.filter(
      (id) => agentTasks.find((t) => t.id === id)?.status === "running",
    );
    if (running.length === 0) {
      showNotification("没有可终止的运行中任务", "info");
      return;
    }
    if (!confirm(`确定要终止 ${running.length} 个运行中的任务？`)) return;
    try {
      for (const id of running) {
        await cancelAgentTask(id);
      }
      setSelectedAgentTaskIds([]);
      showNotification(`已终止 ${running.length} 个任务`, "success");
    } catch {
      showNotification("部分任务终止失败", "error");
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN");
  };

  const loadOrchestrationData = async () => {
    try {
      const [plansData, flowsData] = await Promise.all([
        http.get<PlanItem[]>("/v1/plans"),
        http.get<FlowItem[]>("/v1/flows"),
      ]);
      setPlans(Array.isArray(plansData) ? plansData : []);
      setFlows(Array.isArray(flowsData) ? flowsData : []);
    } catch {
      // silent
    }
  };

  const statusDot = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-400",
      running: "bg-blue-400 animate-pulse",
      completed: "bg-green-400",
      failed: "bg-red-400",
      cancelled: "bg-gray-400",
      aborted: "bg-red-400",
    };
    return map[s] || "bg-gray-300";
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
        {/* 运行中任务卡片 */}
        <div className="mb-4">
          <RunningTasksCard />
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            任务中心
          </h2>
          <div className="flex gap-2">
            {pageTab === "tasks" && (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* 页面级 Tab 切换 */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setPageTab("tasks")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              pageTab === "tasks"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Agent 任务
          </button>
          <button
            onClick={() => setPageTab("plans")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              pageTab === "plans"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            任务计划
          </button>
        </div>

        {pageTab === "plans" ? (
          <PlansPanel />
        ) : (
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
                        {
                          agentTasks.filter((t) => t.status === "running")
                            .length
                        }
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

              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded"
                  />
                  自动刷新
                </label>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span className="text-xs text-gray-400">
                  已失联 {agentTasks.filter((t) => t.status === "lost").length}
                </span>
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
                      onClick={handleBatchKill}
                      className="px-3 py-1.5 text-sm bg-orange-600 hover:bg-orange-700 text-white rounded-lg"
                    >
                      批量终止
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
                    onChange={(e) =>
                      setAgentStatusFilter(
                        e.target.value as typeof agentStatusFilter,
                      )
                    }
                    className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100"
                  >
                    <option value="all">全部状态</option>
                    <option value="pending">等待中</option>
                    <option value="running">运行中</option>
                    <option value="completed">已完成</option>
                    <option value="failed">失败</option>
                    <option value="lost">已失联</option>
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
                      setAgentSortOrder(
                        agentSortOrder === "asc" ? "desc" : "asc",
                      )
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
                              {task.status === "lost" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRecoverTask(task.id);
                                  }}
                                  disabled={recoveringIds.has(task.id)}
                                  className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                                  title="恢复"
                                >
                                  {recoveringIds.has(task.id) ? (
                                    <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                  ) : (
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
                                  )}
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
                            {task.status === "lost" && (
                              <div className="flex items-center gap-2 mr-2">
                                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                                  失联
                                </span>
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
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {selectedTask.name}
                    </h3>
                    <button
                      onClick={() => selectAgentTask(null)}
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

                  {/* Tabs */}
                  <div className="flex gap-1 mb-3 border-b border-gray-100 dark:border-gray-700 pb-2">
                    {(
                      [
                        "info",
                        "audit",
                        "output",
                        "chat",
                        "orchestrate",
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => {
                          setDetailTab(tab);
                          if (tab === "output" && !outputContent)
                            reloadOutput(selectedTask.id);
                          if (tab === "orchestrate" && plans.length === 0) {
                            loadOrchestrationData();
                          }
                        }}
                        className={`text-xs px-2.5 py-1 rounded-t transition-colors ${
                          detailTab === tab
                            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        {tab === "info"
                          ? "详情"
                          : tab === "audit"
                            ? "审计"
                            : tab === "output"
                              ? "输出"
                              : tab === "chat"
                                ? "对话"
                                : "编排"}
                      </button>
                    ))}
                  </div>

                  {/* Info Tab */}
                  {detailTab === "info" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${agentStatusColor[selectedTask.status] || ""}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${selectedTask.status === "running" ? "bg-blue-400 animate-pulse" : selectedTask.status === "completed" ? "bg-green-400" : selectedTask.status === "failed" ? "bg-red-400" : selectedTask.status === "lost" ? "bg-gray-400" : "bg-gray-400"}`}
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
                              ? "高"
                              : selectedTask.priority === "medium"
                                ? "中"
                                : "低"}
                          </span>
                        )}
                      </div>
                      {selectedTask.description && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                          {selectedTask.description}
                        </p>
                      )}
                      {taskState && (
                        <div className="text-xs text-gray-500 space-y-1 bg-gray-50 dark:bg-gray-700/30 p-2 rounded">
                          <div>类型: {(taskState.type as string) || "-"}</div>
                          <div>
                            工具调用: {(taskState.toolUseCount as number) ?? 0}{" "}
                            次
                          </div>
                          <div>
                            Token: {(taskState.tokenCount as number) ?? 0}
                          </div>
                          <div>
                            创建:{" "}
                            {typeof taskState.startTime === "number"
                              ? formatTimestamp(taskState.startTime as number)
                              : "-"}
                          </div>
                        </div>
                      )}
                      {selectedTask.tokenUsed !== undefined && (
                        <div className="text-xs text-gray-500">
                          Token 消耗: {selectedTask.tokenUsed}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        创建: {formatTimestamp(selectedTask.created_at)}
                      </div>

                      {taskLogs.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                            日志
                          </p>
                          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-auto max-h-32 font-mono bg-gray-50 dark:bg-gray-700/50 p-2 rounded border">
                            {taskLogs.slice(-20).join("\n")}
                          </pre>
                        </div>
                      )}

                      <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-1.5">
                        {selectedTask.status === "pending" && (
                          <button
                            onClick={() =>
                              handleExecuteAgentTask(selectedTask.name)
                            }
                            className="w-full text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded"
                          >
                            ▶ 执行任务
                          </button>
                        )}
                        {selectedTask.status === "running" && (
                          <button
                            onClick={() => cancelAgentTask(selectedTask.id)}
                            className="w-full text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded"
                          >
                            ⏹ 终止任务
                          </button>
                        )}
                        {(selectedTask.status === "completed" ||
                          selectedTask.status === "failed") && (
                          <button
                            onClick={() =>
                              handleExecuteAgentTask(selectedTask.name)
                            }
                            className="w-full text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded"
                          >
                            ↻ 重新执行
                          </button>
                        )}
                        {selectedTask.status === "lost" && (
                          <button
                            onClick={() => handleRecoverTask(selectedTask.id)}
                            disabled={recoveringIds.has(selectedTask.id)}
                            className="w-full text-xs px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded disabled:opacity-50"
                          >
                            {recoveringIds.has(selectedTask.id)
                              ? "恢复中..."
                              : "🔄 恢复任务"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Audit Tab */}
                  {detailTab === "audit" && (
                    <div>
                      {!auditLogs ||
                      !Array.isArray(auditLogs) ||
                      auditLogs.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-6">
                          暂无审计记录
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-[320px] overflow-y-auto">
                          {auditLogs.map((entry, i) => (
                            <div
                              key={i}
                              className="border-l-2 border-gray-200 dark:border-gray-600 pl-2.5 py-0.5"
                            >
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-gray-500">
                                  {new Date(
                                    entry.timestamp,
                                  ).toLocaleTimeString()}
                                </span>
                                <span
                                  className={`px-1 rounded text-[10px] ${
                                    entry.eventType === "state_change"
                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                      : entry.eventType === "lost_detected"
                                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  }`}
                                >
                                  {entry.eventType === "state_change"
                                    ? "变更"
                                    : entry.eventType === "lost_detected"
                                      ? "失联"
                                      : entry.eventType}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                {entry.oldStatus || "(初始)"} →{" "}
                                {entry.newStatus}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Output Tab */}
                  {detailTab === "output" && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-500">任务输出</span>
                        <button
                          onClick={() => reloadOutput(selectedTask.id)}
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        >
                          刷新
                        </button>
                      </div>
                      {outputContent === null ? (
                        <div className="flex items-center justify-center py-6">
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-auto max-h-[360px] font-mono bg-gray-50 dark:bg-gray-700/50 p-2 rounded border">
                          {outputContent || "(无输出)"}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Chat Tab */}
                  {detailTab === "chat" && (
                    <AgentChatPanel
                      taskId={selectedTask.id}
                      taskName={selectedTask.name}
                    />
                  )}

                  {/* Orchestrate Tab */}
                  {detailTab === "orchestrate" && (
                    <div className="space-y-4 max-h-[400px] overflow-y-auto">
                      {/* PDCA 管线 */}
                      <PdcaPipeline taskId={selectedTask.id} />
                      <hr className="border-gray-100 dark:border-gray-700" />
                      {/* Kanban 看板 */}
                      <KanbanBoard />
                      <hr className="border-gray-100 dark:border-gray-700" />
                      {/* Plans 编排计划 */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            历史计划 (Plan)
                          </span>
                          <button
                            onClick={loadOrchestrationData}
                            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                          >
                            刷新
                          </button>
                        </div>
                        {plans.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-3">
                            暂无编排计划
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {plans.map((plan) => (
                              <div
                                key={plan.id}
                                className="border border-gray-200 dark:border-gray-700 rounded p-2"
                              >
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${statusDot(plan.status)}`}
                                  />
                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                    {plan.description || plan.id}
                                  </span>
                                </div>
                                {plan.steps && (
                                  <div className="space-y-1">
                                    {plan.steps.map((step, si: number) => (
                                      <div
                                        key={step.id}
                                        className="flex items-center gap-1.5"
                                      >
                                        <span className="w-4 h-4 flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-[9px] text-gray-500 shrink-0">
                                          {si + 1}
                                        </span>
                                        <div className="flex items-center gap-1 flex-1 min-w-0">
                                          <span
                                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(step.status)}`}
                                          />
                                          <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                                            {step.description}
                                          </span>
                                        </div>
                                        <span className="text-[9px] text-gray-400">
                                          {step.status}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Flows 流程图 */}
                      <div>
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          流程图 (Flow)
                        </span>
                        {flows.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-3">
                            暂无流程图
                          </p>
                        ) : (
                          <div className="space-y-2 mt-2">
                            {flows.map((flow) => (
                              <div
                                key={flow.flowId}
                                className="border border-gray-200 dark:border-gray-700 rounded p-2"
                              >
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${statusDot(flow.status)}`}
                                  />
                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                                    {flow.goal || flow.flowId}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                  <span>状态: {flow.status}</span>
                                  <span>
                                    owner: {flow.ownerKey?.slice(0, 8)}
                                  </span>
                                  {flow.currentStep && (
                                    <span>步骤: {flow.currentStep}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

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
                                "cron" | "interval" | "once",
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
                              "high" | "medium" | "low",
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
