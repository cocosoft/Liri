/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { BuddyCompanion, BuddyInteractionResult } from "../types";

export type { BuddyCompanion, BuddyInteractionResult };

/** Buddy 状态切片 */
interface BuddySlice {
  companion: BuddyCompanion | null;
  lastInteraction: BuddyInteractionResult | null;
  stats: { interactions: number; dreamsCompleted: number; totalXp: number } | null;
  isLoading: boolean;
  error: string | null;
  loadBuddy: (name?: string) => Promise<void>;
  interact: (action: string, name?: string) => Promise<void>;
  loadStats: () => Promise<void>;
}

function buddySlice(s: any): BuddySlice {
  return {
    companion: s.buddyCompanion,
    lastInteraction: s.buddyLastInteraction,
    stats: s.buddyStats,
    isLoading: s.buddyLoading,
    error: s.buddyError,
    loadBuddy: s.loadBuddy,
    interact: s.buddyInteract,
    loadStats: s.loadBuddyStats,
  };
}

export function useBuddyStore(): BuddySlice;
export function useBuddyStore<T>(selector: (slice: BuddySlice) => T): T;
export function useBuddyStore(selector?: any): any {
  const companion = useAppStore((s) => s.buddyCompanion);
  const lastInteraction = useAppStore((s) => s.buddyLastInteraction);
  const stats = useAppStore((s) => s.buddyStats);
  const isLoading = useAppStore((s) => s.buddyLoading);
  const error = useAppStore((s) => s.buddyError);
  const loadBuddy = useAppStore((s) => s.loadBuddy);
  const interact = useAppStore((s) => s.buddyInteract);
  const loadStats = useAppStore((s) => s.loadBuddyStats);
  const slice: BuddySlice = { companion, lastInteraction, stats, isLoading, error, loadBuddy, interact, loadStats };
  return selector ? selector(slice) : slice;
}

useBuddyStore.getState = () => buddySlice(useAppStore.getState());
useBuddyStore.setState = (partial: Partial<BuddySlice>) => {
  useAppStore.setState({
    ...(partial.companion !== undefined && { buddyCompanion: partial.companion }),
    ...(partial.lastInteraction !== undefined && { buddyLastInteraction: partial.lastInteraction }),
    ...(partial.stats !== undefined && { buddyStats: partial.stats }),
    ...(partial.isLoading !== undefined && { buddyLoading: partial.isLoading }),
    ...(partial.error !== undefined && { buddyError: partial.error }),
  } as any);
};
