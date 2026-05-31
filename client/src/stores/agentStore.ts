import { create } from 'zustand';
import type { AgentTask, AgentProgress } from '../types';
import { agentService } from '../services/agentService';

interface AgentStore {
  tasks: AgentTask[];
  isLoading: boolean;
  error: string | null;
  taskProgress: AgentProgress | null;
  loadTasks: () => Promise<void>;
  executeTask: (name: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  getTaskProgress: (id: string) => Promise<AgentProgress | null>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,
  taskProgress: null,

  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await agentService.listTasks();
      set({ tasks, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  executeTask: async (name) => {
    set({ error: null });
    try {
      const task = await agentService.executeTask(name);
      set({ tasks: [task, ...get().tasks] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  cancelTask: async (id) => {
    try {
      await agentService.cancelTask(id);
      set({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, status: 'failed' as const } : t
        ),
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
}));
