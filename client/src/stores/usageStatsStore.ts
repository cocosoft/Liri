/**
 * Usage Stats Store — 独立 Zustand Store
 *
 * 管理用量统计数据的加载和状态。
 */
import { create } from "zustand";
import { usageService } from "../services/usageService";
import { handleClientError } from "@/utils/handleError";
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
} from "../types";

interface UsageStatsStore {
  summary: UsageSummary | null;
  trends: DailyUsageStats[];
  modelStats: ModelUsageStats[];
  providerStats: ProviderUsageStats[];
  isLoading: boolean;
  error: string | null;

  loadAll: (rangeDays?: number) => Promise<void>;
  clearError: () => void;
}

export const useUsageStatsStore = create<UsageStatsStore>()((set) => ({
  summary: null,
  trends: [],
  modelStats: [],
  providerStats: [],
  isLoading: false,
  error: null,

  loadAll: async (rangeDays = 30) => {
    set({ isLoading: true, error: null });
    try {
      const end = Math.floor(Date.now() / 1000);
      const start = end - rangeDays * 86400;
      const range = { startDate: start, endDate: end };
      const todayEnd = Math.floor(Date.now() / 1000);
      const todayStart = todayEnd - 86400;
      const todayRange = { startDate: todayStart, endDate: todayEnd };

      const [summary, trends, modelStats, providerStats] = await Promise.all([
        usageService.summary(todayRange),
        usageService.trend(range),
        usageService.modelStats(range),
        usageService.providerStats(range),
      ]);
      set({ summary, trends, modelStats, providerStats, isLoading: false });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:usageStatsStore", action: "loadAll" },
        "warn",
      );
      set({
        error: e instanceof Error ? e.message : "获取使用量统计失败",
        isLoading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
