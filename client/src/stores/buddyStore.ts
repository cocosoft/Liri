/**
 * Buddy 状态存储 — 独立 Zustand Store
 *
 * 管理 AI 伙伴（Buddy Companion）的状态、交互与统计。
 */
import { create } from "zustand";
import { buddyService } from "../services/userService";
import { sseService } from "../services/sseService";
import { handleClientError } from "@/utils/handleError";
import type { BuddyCompanion, BuddyInteractionResult } from "../types";

export type { BuddyCompanion, BuddyInteractionResult };

/** Buddy Store 状态切片 */
interface BuddyStore {
  companion: BuddyCompanion | null;
  lastInteraction: BuddyInteractionResult | null;
  stats: {
    interactions: number;
    dreamsCompleted: number;
    totalXp: number;
  } | null;
  isLoading: boolean;
  error: string | null;
  loadBuddy: (name?: string) => Promise<void>;
  interact: (action: string, name?: string) => Promise<void>;
  loadStats: () => Promise<void>;
  /** 更新伙伴资料（类型 / 名字 / 性格）；返回是否成功 */
  updateCompanion: (patch: {
    name?: string;
    personality?: string;
    species?: string;
  }) => Promise<boolean>;
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
      handleClientError(
        e,
        { module: "stores:buddyStore", action: "loadBuddy" },
        "warn",
      );
      set({ error: String(e), isLoading: false });
    }
  },

  interact: async (action: string, name?: string) => {
    set({ error: null });
    try {
      const result = await buddyService.interact(action, name);
      set({ companion: result.companion, lastInteraction: result });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:buddyStore", action: "interact" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  loadStats: async () => {
    try {
      const stats = await buddyService.getStats();
      set({ stats });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:buddyStore", action: "loadStats" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  updateCompanion: async (patch) => {
    try {
      const companion = await buddyService.updateCompanion(patch);
      set({ companion, error: null });
      return true;
    } catch (e) {
      handleClientError(e, {
        module: "stores:buddyStore",
        action: "updateCompanion",
      });
      set({ error: String(e) });
      return false;
    }
  },
}));

// ── 伙伴实时状态：孵化 / 成长（经验·等级）由服务端广播（2026-11-25） ──
// 经验/等级真源 = `buddy-growth.json`；前端只做「收到事件 → 重新拉快照与统计」，
// 不再本地累加（旧实现基于服务端并不存在的 experience 字段，会算出 NaN）。
const refreshBuddyFromServer = (): void => {
  const state = useBuddyStore.getState();
  void state.loadBuddy();
  void state.loadStats();
};

sseService.on("buddy:hatched", refreshBuddyFromServer);
sseService.on("buddy:growth", refreshBuddyFromServer);
sseService.on("buddy:updated", refreshBuddyFromServer);
