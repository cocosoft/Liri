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
};
