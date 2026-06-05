import { http } from "./httpClient";
import type { ModelInfo } from "../types";

export type { ModelInfo };

export const modelService = {
  async list(): Promise<ModelInfo[]> {
    const response = await http.get<{ object: string; data: ModelInfo[] }>(
      "/v1/models",
    );
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  },

  async get(id: string): Promise<ModelInfo | null> {
    const models = await this.list();
    return models.find((m) => m.id === id) || null;
  },

  async toggle(id: string): Promise<boolean> {
    const resp = await http.patch<{ data: { modelId: string; enabled: boolean } }>(
      `/v1/models/${encodeURIComponent(id)}/toggle`,
    );
    return resp.data.enabled;
  },

  async remove(id: string): Promise<void> {
    await http.delete<{ success: boolean }>(`/v1/models/${encodeURIComponent(id)}`);
  },
};
