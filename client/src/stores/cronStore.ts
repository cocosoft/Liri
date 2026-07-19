/**
 * Cron Store — 独立 Zustand Store
 *
 * 管理定时任务的 CRUD、调度器状态查询等操作。
 */
import { create } from "zustand";
import { cronService } from "../services/cronService";
import { handleClientError } from "@/utils/handleError";
import type { CronTask, ScheduleMode } from "../types";



export type { CronTask, ScheduleMode };

interface CronStore {
  tasks: CronTask[];
  isLoading: boolean;
  error: string | null;
  saving: boolean;
  schedulerStatus: { running: boolean; lastTickAt?: number; activeJobs: number; totalJobs: number; uptimeMs: number } | null;
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

export const useCronStore = create<CronStore>()((set) => ({
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
      handleClientError(e, { module: 'stores:cronStore', action: 'loadTasks' }, 'warn');
      set({ error: String(e), isLoading: false });
    }
  },

  loadStatus: async () => {
    set({ statusLoading: true });
    try {
      const status = await cronService.getStatus();
      set({ schedulerStatus: status, statusLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:cronStore', action: 'loadStatus' }, 'warn');
      set({ schedulerStatus: null, statusLoading: false });
    }
  },

  createTask: async (task) => {
    set({ saving: true });
    try {
      const created = await cronService.create(task as any);
      set((state) => ({ tasks: [...state.tasks, created] }));
    } catch (e) {
      handleClientError(e, { module: 'stores:cronStore', action: 'createTask' }, 'warn');
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  updateTask: async (id, updates) => {
    set({ saving: true });
    try {
      const updated = await cronService.update(id, updates);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (e) {
      handleClientError(e, { module: 'stores:cronStore', action: 'updateTask' }, 'warn');
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  deleteTask: async (id) => {
    set({ saving: true });
    try {
      await cronService.delete(id);
      set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
    } catch (e) {
      handleClientError(e, { module: 'stores:cronStore', action: 'deleteTask' }, 'warn');
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },

  toggleTask: async (id, enabled) => {
    set({ saving: true });
    try {
      const updated = await cronService.toggle(id, enabled);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (e) {
      handleClientError(e, { module: 'stores:cronStore', action: 'toggleTask' }, 'warn');
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
      handleClientError(e, { module: 'stores:cronStore', action: 'runTaskNow' }, 'warn');
      set({ error: String(e) });
    } finally {
      set({ saving: false });
    }
  },
}));
