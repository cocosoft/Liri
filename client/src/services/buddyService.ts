import { httpLegacy as http } from "./httpClient";
import type { BuddyCompanion, BuddyInteractionResult } from "../types";

export const buddyService = {
  getBuddy: async (name?: string): Promise<BuddyCompanion> => {
    const params = name ? `?name=${encodeURIComponent(name)}` : "";
    return http.get<BuddyCompanion>(`/v1/buddy/companion${params}`);
  },

  interact: async (
    action: string,
    name?: string,
  ): Promise<BuddyInteractionResult> => {
    return http.post<BuddyInteractionResult>("/v1/buddy/interact", {
      action,
      name,
    });
  },

  getStats: async (): Promise<{
    interactions: number;
    dreamsCompleted: number;
    totalXp: number;
  }> => {
    return http.get("/v1/buddy/stats");
  },
};
