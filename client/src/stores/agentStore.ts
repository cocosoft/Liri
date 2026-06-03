import { create } from "zustand";
import type { AgentTask, AgentProgress } from "../types";
import { agentService } from "../services/agentService";

interface AgentStore {
  tasks: AgentTask[];
  isLoading: boolean;
  error: string | null;
  taskProgress: AgentProgress | null;
  selectedTask: AgentTask | null;
  taskLogs: string[];
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
  getTaskLogs: (id: string) => Promise<void>;
  selectTask: (task: AgentTask | null) => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,
  taskProgress: null,
  selectedTask: null,
  taskLogs: [],

  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await agentService.listTasks();
      set({ tasks, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

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

  executeTask: async (name, params) => {
    set({ error: null });
    try {
      const task = await agentService.executeTask(name, params);
      set({ tasks: [task, ...get().tasks] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateTask: async (id, params) => {
    set({ error: null });
    try {
      const updated = await agentService.updateTask(id, params);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
        selectedTask:
          get().selectedTask?.id === id ? updated : get().selectedTask,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteTask: async (id) => {
    set({ error: null });
    try {
      await agentService.deleteTask(id);
      set({
        tasks: get().tasks.filter((t) => t.id !== id),
        selectedTask: get().selectedTask?.id === id ? null : get().selectedTask,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  cancelTask: async (id) => {
    try {
      await agentService.cancelTask(id);
      const currentSelected = get().selectedTask;
      set({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, status: "failed" as const } : t,
        ),
        selectedTask:
          currentSelected?.id === id
            ? ({ ...currentSelected, status: "failed" as const } as AgentTask)
            : currentSelected,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

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

  getTaskLogs: async (id) => {
    set({ error: null });
    try {
      const logs = await agentService.getTaskLogs(id);
      set({ taskLogs: logs });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectTask: (task) => {
    set({ selectedTask: task });
    if (task) {
      get().getTaskLogs(task.id);
    }
  },
}));
