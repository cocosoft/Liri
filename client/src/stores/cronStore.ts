import { create } from "zustand";
import type { CronTask } from "../types";
import { cronService } from "../services/cronService";

interface CronStore {
  tasks: CronTask[];
  isLoading: boolean;
  error: string | null;

  loadTasks: () => Promise<void>;
  createTask: (task: Omit<CronTask, "id" | "status">) => Promise<void>;
  updateTask: (id: string, updates: Partial<CronTask>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string, enabled: boolean) => Promise<void>;
  runTaskNow: (id: string) => Promise<void>;
}

export const useCronStore = create<CronStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,

  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await cronService.list();
      set({ tasks, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  createTask: async (task) => {
    try {
      const created = await cronService.create(task);
      set({ tasks: [...get().tasks, created] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateTask: async (id, updates) => {
    try {
      const updated = await cronService.update(id, updates);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteTask: async (id) => {
    try {
      await cronService.delete(id);
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleTask: async (id, enabled) => {
    try {
      const updated = await cronService.toggle(id, enabled);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  runTaskNow: async (id) => {
    try {
      await cronService.runNow(id);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
