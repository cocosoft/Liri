import { http } from './httpClient';
import type { ModelInfo } from '../types';

export type { ModelInfo };

export const modelService = {
  async list(): Promise<ModelInfo[]> {
    const response = await http.get<{ object: string; data: ModelInfo[] }>('/v1/models');
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  },

  async get(id: string): Promise<ModelInfo | null> {
    const models = await this.list();
    return models.find((m) => m.id === id) || null;
  },

  async update(id: string, updates: Partial<ModelInfo>): Promise<void> {
    await http.put(`/v1/models/${encodeURIComponent(id)}`, updates);
  },

  async delete(id: string): Promise<void> {
    await http.delete(`/v1/models/${encodeURIComponent(id)}`);
  },

  async toggle(id: string, enabled: boolean): Promise<void> {
    if (enabled) {
      await http.post(`/v1/models/${encodeURIComponent(id)}/enable`);
    } else {
      await http.post(`/v1/models/${encodeURIComponent(id)}/disable`);
    }
  },
};
