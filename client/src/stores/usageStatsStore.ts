/**
 * Usage Stats Store — 薄委托层
 *
 * 保持向后兼容的导出接口（useUsageStatsStore），
 * 内部状态已合并到 appStore。
 */

import { useAppStore } from "./appStore";
import type {
  UsageSummary,
  DailyUsageStats,
  ModelUsageStats,
  ProviderUsageStats,
} from "../types";

interface UsageStatsSlice {
  summary: UsageSummary | null;
  trends: DailyUsageStats[];
  modelStats: ModelUsageStats[];
  providerStats: ProviderUsageStats[];
  isLoading: boolean;
  error: string | null;
  loadAll: (rangeDays?: number) => Promise<void>;
  clearError: () => void;
}

function mapSlice(s: {
  usageSummary: UsageSummary | null;
  usageTrends: DailyUsageStats[];
  usageModelStats: ModelUsageStats[];
  usageProviderStats: ProviderUsageStats[];
  usageLoading: boolean;
  usageError: string | null;
  loadUsageAll: (rangeDays?: number) => Promise<void>;
  clearUsageError: () => void;
}): UsageStatsSlice {
  return {
    summary: s.usageSummary,
    trends: s.usageTrends,
    modelStats: s.usageModelStats,
    providerStats: s.usageProviderStats,
    isLoading: s.usageLoading,
    error: s.usageError,
    loadAll: s.loadUsageAll,
    clearError: s.clearUsageError,
  };
}

export function useUsageStatsStore(): UsageStatsSlice;
export function useUsageStatsStore<T>(selector: (slice: UsageStatsSlice) => T): T;
export function useUsageStatsStore(selector?: any): any {
  const summary = useAppStore((s) => s.usageSummary);
  const trends = useAppStore((s) => s.usageTrends);
  const modelStats = useAppStore((s) => s.usageModelStats);
  const providerStats = useAppStore((s) => s.usageProviderStats);
  const isLoading = useAppStore((s) => s.usageLoading);
  const error = useAppStore((s) => s.usageError);
  const loadAll = useAppStore((s) => s.loadUsageAll);
  const clearError = useAppStore((s) => s.clearUsageError);
  const slice = { summary, trends, modelStats, providerStats, isLoading, error, loadAll, clearError };
  return selector ? selector(slice) : slice;
}

useUsageStatsStore.getState = () => mapSlice(useAppStore.getState());
