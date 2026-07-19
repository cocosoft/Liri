/**
 * Agent List Slice — 智能体任务列表 CRUD + 执行
 *
 * Phase 3: 从 agentStore.ts 拆分出任务列表管理（Domain A）。
 * 与 AgentDetailStore 并行运行，通过 useAgentStore (index.ts) 联动同步。
 */

import { create } from "zustand";
import type { AgentTask, AgentProgress } from "@/types";
import { agentService } from "@/services/agentService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("stores:agentList");

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
      set({ tasks, isLoading: false });
      logger.debug("任务列表加载完成", { count: tasks.length });
    } catch (e) {
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
      set({ error: String(e) });
    }
  },

  /** 更新任务 */
  updateTask: async (id, params) => {
    set({ error: null });
    try {
      const updated = await agentService.updateTask(id, params);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
      });
    } catch (e) {
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
      set({ error: String(e) });
      return null;
    }
  },
}));
