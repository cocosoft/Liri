import type { DreamLogResponse } from "../types";
import { httpLegacy as http } from "./httpClient";

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
