import { create } from "zustand";
import type { CronTask, ScheduleMode } from "../types";
import { cronService } from "../services/cronService";

interface CronSchedulerStatus {
  running: boolean;
  lastTickAt?: number;
  activeJobs: number;
  totalJobs: number;
  uptimeMs: number;
}

interface CronStore {
  tasks: CronTask[];
  isLoading: boolean;
  error: string | null;
  saving: boolean;
  schedulerStatus: CronSchedulerStatus | null;
  statusLoading: boolean;

  loadTasks: () => Promise<void>;
  loadStatus: () => Promise<void>;
  createTask: (task: {
    name: string;
    expression: string;
    prompt?: string;
    description?: string;
    enabled?: boolean;
    scheduleMode?: ScheduleMode;
    silent?: boolean;
    everyValue?: number;
    everyUnit?: string;
    atHour?: string;
    atMinute?: string;
    deliver?: string;
    deliverTo?: string;
  }) => Promise<void>;
  updateTask: (id: string, updates: Partial<CronTask>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string, enabled: boolean) => Promise<void>;
  runTaskNow: (id: string) => Promise<void>;
}

export const useCronStore = create<CronStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,
  saving: false,
  schedulerStatus: null,
  statusLoading: false,

  loadTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await cronService.list();
      set({ tasks, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  loadStatus: async () => {
    set({ statusLoading: true });
    try {
      const status = await cronService.getStatus();
      set({ schedulerStatus: status, statusLoading: false });
    } catch {
      set({ schedulerStatus: null, statusLoading: false });
    }
  },

  createTask: async (task) => {
    set({ saving: true });
    try {
      const created = await cronService.create({
        name: task.name,
        expression: task.expression,
        prompt: task.prompt,
        description: task.description ?? "",
        enabled: task.enabled ?? true,
        scheduleMode: task.scheduleMode,
        silent: task.silent,
        everyValue: task.everyValue,
        everyUnit: task.everyUnit,
        atHour: task.atHour,
        atMinute: task.atMinute,
        deliver: task.deliver,
        deliverTo: task.deliverTo,
      } as any);
      set({ tasks: [...get().tasks, created] });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  updateTask: async (id, updates) => {
    set({ saving: true });
    try {
      const updated = await cronService.update(id, updates);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  deleteTask: async (id) => {
    set({ saving: true });
    try {
      await cronService.delete(id);
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  toggleTask: async (id, enabled) => {
    set({ saving: true });
    try {
      const updated = await cronService.toggle(id, enabled);
      set({
        tasks: get().tasks.map((t) => (t.id === id ? updated : t)),
      });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  runTaskNow: async (id) => {
    set({ saving: true });
    try {
      await cronService.runNow(id);
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },
}));
