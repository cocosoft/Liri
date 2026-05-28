import { create } from 'zustand';
import type { AgentTask } from '../types';
import { agentService } from '../services/agentService';

interface AgentStore {
  tasks: AgentTask[];
  isLoading: boolean;
  error: string | null;
  loadTasks: () => Promise<void>;
  executeTask: (name: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,

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
}));
