/**
 * Buddy 状态存储 — 独立 Zustand Store
 *
 * 管理 AI 伙伴（Buddy Companion）的状态、交互与统计。
 */
import { create } from "zustand";
import { buddyService } from "../services/buddyService";
import { handleClientError } from "@/utils/handleError";
import type { BuddyCompanion, BuddyInteractionResult } from "../types";

export type { BuddyCompanion, BuddyInteractionResult };

/** Buddy Store 状态切片 */
interface BuddyStore {
  companion: BuddyCompanion | null;
  lastInteraction: BuddyInteractionResult | null;
  stats: { interactions: number; dreamsCompleted: number; totalXp: number } | null;
  isLoading: boolean;
  error: string | null;
  loadBuddy: (name?: string) => Promise<void>;
  interact: (action: string, name?: string) => Promise<void>;
  loadStats: () => Promise<void>;
}

/**
 * Buddy 状态管理 Store
 *
 * 提供伙伴的加载、交互和统计数据管理。
 * 所有操作通过 buddyService 代理到后端 /v1/buddy/* 接口。
 */
export const useBuddyStore = create<BuddyStore>((set) => ({

  companion: null,
  lastInteraction: null,
  stats: null,
  isLoading: false,
  error: null,

  loadBuddy: async (name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const companion = await buddyService.getBuddy(name);
      set({ companion, isLoading: false });
    } catch (e) {
      handleClientError(e, { module: 'stores:buddyStore', action: 'loadBuddy' }, 'warn');
      set({ error: String(e), isLoading: false });
    }
  },

  interact: async (action: string, name?: string) => {
    set({ error: null });
    try {
      const result = await buddyService.interact(action, name);
      set({ companion: result.companion, lastInteraction: result });
    } catch (e) {
      handleClientError(e, { module: 'stores:buddyStore', action: 'interact' }, 'warn');
      set({ error: String(e) });
    }
  },

  loadStats: async () => {
    try {
      const stats = await buddyService.getStats();
      set({ stats });
    } catch (e) {
      handleClientError(e, { module: 'stores:buddyStore', action: 'loadStats' }, 'warn');
      set({ error: String(e) });
    }
  },

}));
