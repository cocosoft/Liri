import { create } from "zustand";
import type { BuddyCompanion, BuddyInteractionResult } from "../types";
import { buddyService } from "../services/buddyService";

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
}

export const useBuddyStore = create<BuddyStore>((set) => ({
  companion: null,
  lastInteraction: null,
  stats: null,
  isLoading: false,
  error: null,

  loadBuddy: async (name) => {
    set({ isLoading: true, error: null });
    try {
      const companion = await buddyService.getBuddy(name);
      set({ companion, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  interact: async (action, name) => {
    set({ error: null });
    try {
      const result = await buddyService.interact(action, name);
      set({ companion: result.companion, lastInteraction: result });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadStats: async () => {
    try {
      const stats = await buddyService.getStats();
      set({ stats });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
