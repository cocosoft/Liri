import type { CronTask } from "../types";
import { http } from "./httpClient";

interface CronSchedulerStatus {
  running: boolean;
  lastTickAt?: number;
  activeJobs: number;
  totalJobs: number;
  uptimeMs: number;
}

export const cronService = {
  list: async (): Promise<CronTask[]> => {
    return http.get<CronTask[]>("/v1/cron");
  },

  getStatus: async (): Promise<CronSchedulerStatus> => {
    return http.get<CronSchedulerStatus>("/v1/cron/status");
  },

  create: async (task: Omit<CronTask, "id" | "status">): Promise<CronTask> => {
    return http.post<CronTask>("/v1/cron", task);
  },

  update: async (id: string, updates: Partial<CronTask>): Promise<CronTask> => {
    return http.put<CronTask>(`/v1/cron/${id}`, updates);
  },

  delete: async (id: string): Promise<void> => {
    return http.delete<void>(`/v1/cron/${id}`);
  },

  toggle: async (id: string, enabled: boolean): Promise<CronTask> => {
    return http.put<CronTask>(`/v1/cron/${id}`, { enabled });
  },

  runNow: async (id: string): Promise<void> => {
    return http.post<void>(`/v1/cron/${id}/run`);
  },
};
