/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { CronTask, ScheduleMode } from "../types";

export type { CronTask, ScheduleMode };

/** Cron 状态切片 */
interface CronSlice {
  tasks: CronTask[];
  isLoading: boolean;
  error: string | null;
  saving: boolean;
  schedulerStatus: { running: boolean; lastTickAt?: number; activeJobs: number; totalJobs: number; uptimeMs: number } | null;
  statusLoading: boolean;
  loadTasks: () => Promise<void>;
  loadStatus: () => Promise<void>;
  createTask: (task: {
    name: string; expression: string; prompt?: string; description?: string;
    enabled?: boolean; scheduleMode?: ScheduleMode; silent?: boolean;
    everyValue?: number; everyUnit?: string; atHour?: string; atMinute?: string;
    deliver?: string; deliverTo?: string;
  }) => Promise<void>;
  updateTask: (id: string, updates: Partial<CronTask>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string, enabled: boolean) => Promise<void>;
  runTaskNow: (id: string) => Promise<void>;
}

function cronSlice(s: any): CronSlice {
  return {
    tasks: s.cronTasks,
    isLoading: s.cronLoading,
    error: s.cronError,
    saving: s.cronSaving,
    schedulerStatus: s.cronSchedulerStatus,
    statusLoading: s.cronStatusLoading,
    loadTasks: s.loadCronTasks,
    loadStatus: s.loadCronStatus,
    createTask: s.createCronTask,
    updateTask: s.updateCronTask,
    deleteTask: s.deleteCronTask,
    toggleTask: s.toggleCronTask,
    runTaskNow: s.runCronTaskNow,
  };
}

export function useCronStore(): CronSlice;
export function useCronStore<T>(selector: (slice: CronSlice) => T): T;
export function useCronStore(selector?: any): any {
  const tasks = useAppStore((s) => s.cronTasks);
  const isLoading = useAppStore((s) => s.cronLoading);
  const error = useAppStore((s) => s.cronError);
  const saving = useAppStore((s) => s.cronSaving);
  const schedulerStatus = useAppStore((s) => s.cronSchedulerStatus);
  const statusLoading = useAppStore((s) => s.cronStatusLoading);
  const loadTasks = useAppStore((s) => s.loadCronTasks);
  const loadStatus = useAppStore((s) => s.loadCronStatus);
  const createTask = useAppStore((s) => s.createCronTask);
  const updateTask = useAppStore((s) => s.updateCronTask);
  const deleteTask = useAppStore((s) => s.deleteCronTask);
  const toggleTask = useAppStore((s) => s.toggleCronTask);
  const runTaskNow = useAppStore((s) => s.runCronTaskNow);
  const slice: CronSlice = { tasks, isLoading, error, saving, schedulerStatus, statusLoading, loadTasks, loadStatus, createTask, updateTask, deleteTask, toggleTask, runTaskNow };
  return selector ? selector(slice) : slice;
}

useCronStore.getState = () => cronSlice(useAppStore.getState());
useCronStore.setState = (partial: Partial<CronSlice>) => {
  useAppStore.setState({
    ...(partial.tasks !== undefined && { cronTasks: partial.tasks }),
    ...(partial.isLoading !== undefined && { cronLoading: partial.isLoading }),
    ...(partial.error !== undefined && { cronError: partial.error }),
    ...(partial.saving !== undefined && { cronSaving: partial.saving }),
    ...(partial.schedulerStatus !== undefined && { cronSchedulerStatus: partial.schedulerStatus }),
    ...(partial.statusLoading !== undefined && { cronStatusLoading: partial.statusLoading }),
  } as any);
};
