/**
 * Agent List Slice — 智能体任务列表 CRUD + 执行
 *
 * Phase 3: 从 agentStore.ts 拆分出任务列表管理（Domain A）。
 * 与 AgentDetailStore 并行运行，通过 useAgentStore (index.ts) 联动同步。
 *
 * P3（08-09）：订阅 SSE task:progress / task:completed 事件实现实时更新，
 * 消除轮询与 SSE 双通道竞态。SSE 更新后 5s 内轮询不覆盖同任务。
 */

import { create } from "zustand";
import type { AgentTask, AgentProgress } from "@/types";
import { agentService } from "@/services/agentService";
import { sseService } from "@/services/sseService";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("stores:agentList");

// ─── SSE → 轮询竞态防护 ──────────────────────────

/** SSE 最近更新过的任务 ID → 时间戳，5s 内轮询不覆盖 */
const sseUpdatedTasks = new Map<string, number>();
const SSE_GUARD_WINDOW_MS = 5000;

function isRecentlyUpdatedBySse(taskId: string): boolean {
  const ts = sseUpdatedTasks.get(taskId);
  return ts !== undefined && Date.now() - ts < SSE_GUARD_WINDOW_MS;
}

// ─── 接口 ─────────────────────────────────────────

export interface AgentListSlice {
  tasks: AgentTask[];
  isLoading: boolean;
  error: string | null;
  taskProgress: AgentProgress | null;

  loadTasks: () => Promise<void>;
  createTask: (params: {
    name: string;
    description?: string;
    prompt?: string;
    priority?: "high" | "medium" | "low";
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  executeTask: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<void>;
  updateTask: (
    id: string,
    params: { name?: string; description?: string },
  ) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  getTaskProgress: (id: string) => Promise<AgentProgress | null>;
}

// ─── Store 实现 ──────────────────────────────────

export const useAgentListStore = create<AgentListSlice>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,
  taskProgress: null,

  /** 加载任务列表 */
  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await agentService.listTasks();
      // P3：合并 SSE 已更新的任务（5s 窗口内不覆盖）
      const current = get().tasks;
      const merged = tasks.map((t) => {
        if (isRecentlyUpdatedBySse(t.id)) {
          const existing = current.find((c) => c.id === t.id);
          return existing ?? t;
        }
        return t;
      });
      set({ tasks: merged, isLoading: false });
      logger.debug("任务列表加载完成", { count: tasks.length });
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "loadTasks",
      });
      set({ error: String(e), isLoading: false });
      logger.error("任务列表加载失败", { error: String(e) });
    }
  },

  /** 创建任务 */
  createTask: async (params) => {
    set({ error: null });
    try {
      const task = await agentService.createTask({
        name: params.name,
        description: params.description,
        prompt: params.prompt,
        priority: params.priority,
        metadata: params.metadata,
      });
      set({ tasks: [task, ...get().tasks] });
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "createTask",
      });
      set({ error: String(e) });
    }
  },

  /** 执行任务 */
  executeTask: async (name, params) => {
    set({ error: null });
    try {
      const task = await agentService.executeTask(name, params);
      set({ tasks: [task, ...get().tasks] });
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "executeTask",
      });
      set({ error: String(e) });
    }
  },

  /** 更新任务 */
  updateTask: async (id, params) => {
    set({ error: null });
    try {
      const updated = await agentService.updateTask(id, params);
      if (updated) {
        set({
          tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
        });
      }
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "updateTask",
      });
      set({ error: String(e) });
    }
  },

  /** 删除任务 */
  deleteTask: async (id) => {
    set({ error: null });
    try {
      await agentService.deleteTask(id);
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "deleteTask",
      });
      set({ error: String(e) });
    }
  },

  /** 取消任务 */
  cancelTask: async (id) => {
    try {
      await agentService.cancelTask(id);
      set({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, status: "failed" as const } : t,
        ),
      });
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "cancelTask",
      });
      set({ error: String(e) });
    }
  },

  /** 获取任务进度 */
  getTaskProgress: async (id) => {
    try {
      const progress = await agentService.getTask(id);
      set({ taskProgress: progress });
      return progress;
    } catch (e) {
      handleClientError(e, {
        module: "stores:agent:list",
        action: "getTaskProgress",
      });
      set({ error: String(e) });
      return null;
    }
  },
}));

// ─── SSE 事件订阅（实时更新，消除轮询延迟） ──────────

/**
 * P3（08-09）：订阅 SSE task:progress / task:completed 事件，
 * 实现任务状态实时更新。轮询作为 SSE 断连后的兜底。
 */

interface TaskEventPayload {
  taskId?: string;
  sessionId?: string;
  status?: string;
  stepDesc?: string;
  planId?: string;
}

sseService.on("task:progress", (data: Record<string, unknown>) => {
  const payload = data as TaskEventPayload;
  if (!payload.taskId) return;

  const state = useAgentListStore.getState();
  const task = state.tasks.find((t) => t.id === payload.taskId);
  if (!task) return;

  // 更新任务状态为 running + 进度描述
  sseUpdatedTasks.set(payload.taskId, Date.now());
  useAgentListStore.setState({
    tasks: state.tasks.map((t) =>
      t.id === payload.taskId
        ? {
            ...t,
            status: "running" as const,
            description: payload.stepDesc ?? t.description,
          }
        : t,
    ),
  });
});

sseService.on("task:completed", (data: Record<string, unknown>) => {
  const payload = data as TaskEventPayload;
  if (!payload.taskId) return;

  const state = useAgentListStore.getState();
  const task = state.tasks.find((t) => t.id === payload.taskId);
  if (!task) return;

  // 更新任务状态为 completed
  sseUpdatedTasks.set(payload.taskId, Date.now());
  useAgentListStore.setState({
    tasks: state.tasks.map((t) =>
      t.id === payload.taskId
        ? {
            ...t,
            status:
              payload.status === "failed"
                ? ("failed" as const)
                : ("completed" as const),
          }
        : t,
    ),
  });
});
