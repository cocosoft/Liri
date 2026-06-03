/**
 * 使用量统计 Store
 * 对接 /v1/usage/* 端点
 */

import { create } from "zustand";
import { usageService } from "../services/usageService";
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
} from "../types";

interface UsageStatsState {
  summary: UsageSummary | null;
  trends: DailyUsageStats[];
  modelStats: ModelUsageStats[];
  providerStats: ProviderUsageStats[];
  isLoading: boolean;
  error: string | null;

  loadAll: (rangeDays?: number) => Promise<void>;
  clearError: () => void;
}

function getRange(days: number): { startDate: number; endDate: number } {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  return { startDate: start, endDate: end };
}

export const useUsageStatsStore = create<UsageStatsState>((set) => ({
  summary: null,
  trends: [],
  modelStats: [],
  providerStats: [],
  isLoading: false,
  error: null,

  loadAll: async (rangeDays = 30) => {
    set({ isLoading: true, error: null });
    try {
      const range = getRange(rangeDays);
      const todayRange = getRange(1);

      const [summary, trends, modelStats, providerStats] = await Promise.all([
        usageService.summary(todayRange),
        usageService.trend(range),
        usageService.modelStats(range),
        usageService.providerStats(range),
      ]);
      set({ summary, trends, modelStats, providerStats, isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "获取使用量统计失败",
        isLoading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
