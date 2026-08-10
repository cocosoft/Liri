/**
 * 后台任务服务：定时任务 + 梦境日志 API
 *
 * 由 cronService + dreamService 归并（GR15-001）。
 * 提供定时任务 CRUD（/v1/cron/*）与伙伴梦境日志（/v1/buddy/dreams）API 调用。
 */

import type { CronTask, DreamLogResponse } from "../types";
import { httpLegacy as http } from "./httpClient";

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

export const dreamService = {
  getDreamLogs: async (
    limit: number = 50,
    offset: number = 0,
    type?: string,
  ): Promise<DreamLogResponse> => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (type) {
      params.set("type", type);
    }
    return http.get<DreamLogResponse>(`/v1/buddy/dreams?${params.toString()}`);
  },
};

/** 后台任务运行状况（Dream 记忆整理 + Buddy 成长） */
export interface BackgroundStatus {
  dream: {
    stats: {
      totalCompleted: number;
      totalFailed: number;
      totalSessions: number;
      totalInsights: number;
      lastDreamAt: number | null;
    };
    recentLogs: Array<{
      id: string;
      type: string;
      summary: string;
      sessionsCount: number;
      insightsGenerated: number;
      timestamp: number;
    }>;
  };
  buddyGrowth: {
    totalCompleted: number;
    totalSessions: number;
    totalInsights: number;
    consecutiveDays: number;
    taskCompletionCount: number;
    totalTaskExp: number;
    unlockedAchievements: string[];
  };
  generatedAt: number;
}

export const backgroundStatusService = {
  getStatus: async (): Promise<BackgroundStatus> => {
    return http.get<BackgroundStatus>("/v1/background/status");
  },
};
