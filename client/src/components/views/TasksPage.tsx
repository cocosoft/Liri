/**
 * TasksPage — 任务聚合收件箱（D3）
 *
 * 当前 workspace 内跨项目的任务聚合视图（只读聚合 + 状态流转 + 跳转）。
 * 数据源：GET /v1/tasks?workspaceId=xxx（必须传 workspaceId，否则后端返回空数组，C1）。
 * 分组按任务状态（D-a②：进行中/待办/受阻/已完成），不用 startedAt 冒充到期（C4）。
 * 编辑/新建任务仍在项目页「编排」Tab，本页不承载写表单。
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { taskService } from "../../services/taskService";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useRootStore } from "../../stores/root-store";
import type { TaskNode, TaskStatus, TaskPriority } from "../../types/work";
import { TASK_PRIORITY_LABELS } from "../../types/work";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("views:TasksPage");

/** 分组定义（与 §2.3.4 一致） */
type GroupKey = "active" | "pending" | "blocked" | "done";

const GROUP_OF: Record<TaskStatus, GroupKey> = {
  active: "active",
  review: "active",
  paused: "active",
  planning: "pending",
  pending: "pending",
  failed: "blocked",
  completed: "done",
  archived: "done",
  cancelled: "done",
};

const GROUP_ORDER: GroupKey[] = ["active", "pending", "blocked", "done"];

/**
 * 终态（completed / archived / cancelled）。
 * §2.3.2：状态筛选器不含终态（收件箱关注待办），但「已完成」折叠组需始终可见
 * ——故终态任务绕过状态筛选，直接进入 done 组。
 */
const TERMINAL_STATUSES: TaskStatus[] = ["completed", "archived", "cancelled"];

/** 状态筛选选项（不含 completed/archived——收件箱默认关注待办） */
const STATUS_FILTERS: TaskStatus[] = [
  "planning",
  "pending",
  "active",
  "paused",
  "review",
  "failed",
];

const PRIORITY_FILTERS: TaskPriority[] = [0, 1, 2, 3];

/** 排序键（§2.3.3）：默认优先级，另可选创建时间 / 状态 / 进度 */
type SortKey = "priority" | "createdAt" | "status" | "progress";

/** 状态排序权重（§2.3.3：active → planning → review → pending → paused → failed） */
const STATUS_ORDER: Record<TaskStatus, number> = {
  active: 0,
  planning: 1,
  review: 2,
  pending: 3,
  paused: 4,
  failed: 5,
  completed: 6,
  archived: 7,
  cancelled: 8,
};

/** 状态展示文案的 i18n key（§2.3.5 行级元素「状态」） */
const STATUS_LABEL_KEYS: Record<TaskStatus, string> = {
  planning: "taskInbox.statusPlanning",
  pending: "taskInbox.statusPending",
  active: "taskInbox.statusActive",
  paused: "taskInbox.statusPaused",
  review: "taskInbox.statusReview",
  completed: "taskInbox.statusCompleted",
  archived: "taskInbox.statusArchived",
  failed: "taskInbox.statusFailed",
  cancelled: "taskInbox.statusCancelled",
};

function groupKeyOf(status: TaskStatus): GroupKey {
  return GROUP_OF[status] ?? "pending";
}

function priorityLabel(p: TaskPriority): string {
  return TASK_PRIORITY_LABELS[p] ?? `P${p}`;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export default function TasksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  /**
   * 项目名解析：复用 ProjectsPage 的同源数据（rootStore worktrees）。
   * 客户端"项目"即 workspaceSource === "user" 的 worktree，其 id 就是 TaskNode.projectId
   * （与行级跳转 /projects/:id 的目标 id 一致）。原实现直接显示 projectId 前 8 位。
   */
  const worktrees = useRootStore((s) => s.worktrees);
  const projectNameOf = useCallback(
    (id: string) => worktrees[id]?.name || id.slice(0, 8),
    [worktrees],
  );

  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // 筛选状态
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<Set<TaskStatus>>(
    new Set(["active", "pending", "review"]),
  );
  const [priorityFilter, setPriorityFilter] = useState<Set<TaskPriority>>(
    new Set(PRIORITY_FILTERS),
  );
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set(["done"]));

  const loadTasks = useCallback(async () => {
    if (!workspaceId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const list = await taskService.list({ workspaceId });
      setTasks(list);
    } catch (e) {
      setLoadError(true);
      handleClientError(
        e,
        { module: "views:TasksPage", action: "list" },
        "warn",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  /** 项目筛选项：projectId 来自任务数据，名称由 worktrees 解析（无独立项目列表 API） */
  const projectOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      if (task.projectId) ids.add(task.projectId);
    }
    return [...ids].map((id) => ({ id, name: projectNameOf(id) }));
  }, [tasks, projectNameOf]);

  /** 过滤 + 排序（§2.3.3：默认优先级 ASC → 创建时间 ASC；可选状态 / 进度） */
  const visibleTasks = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (projectFilter !== "all" && task.projectId !== projectFilter)
          return false;
        // 终态绕过状态筛选（§2.3.2：筛选器不含终态，但「已完成」折叠组需始终可见）
        if (
          !TERMINAL_STATUSES.includes(task.status) &&
          !statusFilter.has(task.status)
        )
          return false;
        if (!priorityFilter.has(task.priority)) return false;
        if (keyword) {
          const hay = `${task.title} ${task.tags.join(" ")}`.toLowerCase();
          if (!hay.includes(keyword)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        switch (sortKey) {
          case "createdAt":
            return (
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          case "status":
            return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          case "progress":
            return a.progress - b.progress;
          default:
            if (a.priority !== b.priority) return a.priority - b.priority;
            return (
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
        }
      });
  }, [tasks, projectFilter, statusFilter, priorityFilter, search, sortKey]);

  /** 分组 */
  const grouped = useMemo(() => {
    const map: Record<GroupKey, TaskNode[]> = {
      active: [],
      pending: [],
      blocked: [],
      done: [],
    };
    for (const task of visibleTasks) {
      map[groupKeyOf(task.status)].push(task);
    }
    return map;
  }, [visibleTasks]);

  const toggleSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  /** 状态流转：完成 → completed；取消 → cancelled；受阻重试 → active */
  const changeStatus = useCallback(
    async (task: TaskNode, status: TaskStatus) => {
      const updated = await taskService.update(task.id, { status });
      if (updated) {
        setTasks((prev) =>
          prev.map((n) => (n.id === task.id ? { ...n, status } : n)),
        );
      } else {
        logger.warn("任务状态更新失败", { taskId: task.id, status });
      }
    },
    [],
  );

  /** 行级跳转（§2.2-1）：关联会话 → 切换会话后进入聊天
   *  （应用无 /chat/:sid 路由，会话切换走 sessionStore.switchSession） */
  const openSession = useCallback(
    async (sessionId: string) => {
      try {
        await useSessionStore.getState().switchSession(sessionId);
        navigate("/chat");
      } catch (e) {
        handleClientError(
          e,
          { module: "views:TasksPage", action: "open-session" },
          "warn",
        );
      }
    },
    [navigate],
  );

  const groupLabel: Record<GroupKey, string> = {
    active: t("taskInbox.groupActive", "进行中"),
    pending: t("taskInbox.groupPending", "待办"),
    blocked: t("taskInbox.groupBlocked", "受阻"),
    done: t("taskInbox.groupDone", "已完成"),
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
          {t("taskInbox.title", "任务")}
        </h1>

        {/* 筛选栏（Sticky） */}
        <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-950 py-2 mb-2 flex flex-wrap items-center gap-2 text-sm">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200"
          >
            <option value="all">
              {t("taskInbox.allProjects", "全部项目")}
            </option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("taskInbox.searchPlaceholder", "搜索标题 / 标签")}
            className="border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 min-w-[160px]"
          />

          <div className="flex items-center gap-1">
            {PRIORITY_FILTERS.map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter((s) => toggleSet(s, p))}
                className={`px-1.5 py-0.5 rounded text-xs border ${
                  priorityFilter.has(p)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-gray-900 text-gray-400 border-gray-300 dark:border-gray-700"
                }`}
              >
                {priorityLabel(p)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter((prev) => toggleSet(prev, s))}
                className={`px-1.5 py-0.5 rounded text-xs border ${
                  statusFilter.has(s)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-gray-900 text-gray-400 border-gray-300 dark:border-gray-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* 排序（§2.3.5 [排序▼]；§2.3.3 排序键） */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="border border-gray-300 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-xs"
            title={t("taskInbox.sortLabel", "排序")}
          >
            <option value="priority">
              {t("taskInbox.sortPriority", "优先级")}
            </option>
            <option value="createdAt">
              {t("taskInbox.sortCreatedAt", "创建时间")}
            </option>
            <option value="status">{t("taskInbox.sortStatus", "状态")}</option>
            <option value="progress">
              {t("taskInbox.sortProgress", "进度")}
            </option>
          </select>
        </div>

        {/* 内容区 */}
        {loading && (
          <div className="text-center text-gray-400 py-12">
            {t("taskInbox.loading", "加载中…")}
          </div>
        )}
        {!loading && loadError && (
          <div className="text-center text-red-500 py-12">
            {t("taskInbox.loadFailed", "任务加载失败")}
            <button
              onClick={loadTasks}
              className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("taskInbox.retry", "重试")}
            </button>
          </div>
        )}
        {!loading && !loadError && visibleTasks.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            {t("taskInbox.empty", "当前没有符合条件的任务")}
          </div>
        )}

        {!loading &&
          !loadError &&
          GROUP_ORDER.map((groupKey) => {
            const items = grouped[groupKey];
            const isCollapsed = collapsed.has(groupKey);
            if (items.length === 0) return null;
            return (
              <div key={groupKey} className="mb-4">
                <button
                  onClick={() => setCollapsed((s) => toggleSet(s, groupKey))}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 w-full text-left"
                >
                  <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                  {groupLabel[groupKey]}
                  <span className="text-xs text-gray-400">
                    ({items.length})
                  </span>
                </button>
                {!isCollapsed && (
                  <ul className="space-y-1">
                    {items.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        projectName={
                          task.projectId ? projectNameOf(task.projectId) : ""
                        }
                        onOpenProject={() =>
                          task.projectId &&
                          navigate(`/projects/${task.projectId}`)
                        }
                        onOpenSession={() =>
                          task.sessionId && void openSession(task.sessionId)
                        }
                        onComplete={() => changeStatus(task, "completed")}
                        onCancel={() => changeStatus(task, "cancelled")}
                        onRetry={() => changeStatus(task, "active")}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  projectName,
  onOpenProject,
  onOpenSession,
  onComplete,
  onCancel,
  onRetry,
}: {
  task: TaskNode;
  projectName: string;
  onOpenProject: () => void;
  onOpenSession: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const isDone = TERMINAL_STATUSES.includes(task.status);
  const isFailed = task.status === "failed";
  const started = formatDate(task.startedAt);
  const created = formatDate(task.createdAt);

  return (
    <li className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded">
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex-shrink-0">
        {priorityLabel(task.priority)}
      </span>
      <span
        className={`text-sm flex-1 truncate ${
          isDone
            ? "text-gray-400 line-through"
            : "text-gray-800 dark:text-gray-100"
        }`}
        title={task.description || task.title}
      >
        {task.title}
      </span>

      {/* 状态（§2.3.5 行级元素） */}
      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex-shrink-0">
        {t(STATUS_LABEL_KEYS[task.status])}
      </span>

      {/* 进度条（§2.3.5 行级元素） */}
      <span className="flex w-20 flex-shrink-0 items-center gap-1">
        <span className="h-1.5 flex-1 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <span
            className="block h-full bg-blue-500"
            style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
          />
        </span>
        <span className="text-xs tabular-nums text-gray-400">
          {task.progress}%
        </span>
      </span>

      {task.projectId && (
        <button
          onClick={onOpenProject}
          className="max-w-[10rem] truncate text-xs text-blue-600 hover:underline dark:text-blue-400 flex-shrink-0"
          title={t("taskInbox.openProject", "打开所属项目")}
        >
          {projectName || task.projectId.slice(0, 8)} ↗
        </button>
      )}

      {/* 行级跳转（§2.2-1）：关联会话 */}
      {task.sessionId && (
        <button
          onClick={onOpenSession}
          className="flex-shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400"
          title={t("taskInbox.openSession", "打开关联会话")}
        >
          💬 ↗
        </button>
      )}

      <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right">
        {started
          ? t("taskInbox.startedAt", "开始于 {{date}}", { date: started })
          : created
            ? t("taskInbox.createdAt", "创建于 {{date}}", { date: created })
            : ""}
      </span>

      {!isDone && (
        <button
          onClick={onComplete}
          className="text-xs px-2 py-0.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 flex-shrink-0"
          title={t("taskInbox.markComplete", "标记完成")}
        >
          ✓
        </button>
      )}
      {!isDone && (
        <button
          onClick={onCancel}
          className="flex-shrink-0 rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          title={t("taskInbox.cancelTask", "取消任务")}
        >
          ✕
        </button>
      )}
      {isFailed && (
        <button
          onClick={onRetry}
          className="text-xs px-2 py-0.5 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex-shrink-0"
          title={t("taskInbox.retryTask", "重新激活")}
        >
          ↻
        </button>
      )}
    </li>
  );
}
