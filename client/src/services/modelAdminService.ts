/**
 * 模型管理 API 服务层
 * 提供 Provider CRUD、模型列表管理、配置保存等功能
 */

import { http } from './httpClient';
import type { ProviderInfo, ProviderFormData } from '../types';

const PROVIDER_BASE_PATH = 'models.providers';

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function parseModelIds(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/\n|,|;/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export const modelAdminService = {
  async getConfig(): Promise<Record<string, unknown>> {
    return http.get<Record<string, unknown>>('/v1/config');
  },

  async getProviders(): Promise<ProviderInfo[]> {
    const config = await this.getConfig();
    const models = (config?.models ?? {}) as Record<string, unknown>;
    const entries: ProviderInfo[] = [];

    const addEntry = (id: string, raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const provider = raw as Record<string, unknown>;
      if (!provider.api && !provider.baseUrl) return;

      const modelIds: string[] = [];
      const rawModels = provider.models;
      if (Array.isArray(rawModels)) {
        for (const m of rawModels) {
          if (typeof m === 'string') modelIds.push(m);
          else if (m && typeof m === 'object' && 'id' in m) modelIds.push(String((m as Record<string, string>).id));
        }
      }

      entries.push({
        id: String(id),
        api: String(provider.api ?? ''),
        baseUrl: String(provider.baseUrl ?? provider.baseURL ?? provider.base_url ?? ''),
        modelIds,
        sources: ['providers'],
      });
    };

    const providers = models.providers as Record<string, unknown> | undefined;
    if (providers && typeof providers === 'object') {
      for (const [id, p] of Object.entries(providers)) {
        addEntry(id, p);
      }
    }

    const reserved = new Set(['primary', 'fallback', 'mode', 'providers']);
    for (const [id, p] of Object.entries(models)) {
      if (!reserved.has(id)) addEntry(id, p);
    }

    return entries.sort((a, b) => a.id.localeCompare(b.id));
  },

  async saveProvider(id: string, data: ProviderFormData): Promise<void> {
    const basePath = `${PROVIDER_BASE_PATH}.${normalizeId(id)}`;
    const patches: Array<{ path: string; value: unknown }> = [
      { path: `${basePath}.api`, value: data.api },
      { path: `${basePath}.baseUrl`, value: data.baseUrl.trim() },
      {
        path: `${basePath}.models`,
        value: parseModelIds(data.models).map((m) => ({ id: m })),
      },
    ];

    if (data.apiKey.trim()) {
      patches.push({ path: `${basePath}.apiKey`, value: data.apiKey.trim() });
    }

    // 确保 models.mode 存在
    patches.push({ path: 'models.mode', value: 'merge' });

    for (const patch of patches) {
      await http.put(`/v1/config/${encodeURIComponent(patch.path)}`, { value: patch.value });
    }
  },

  async deleteProvider(id: string): Promise<void> {
    const basePath = `${PROVIDER_BASE_PATH}.${normalizeId(id)}`;
    await http.delete(`/v1/config/${encodeURIComponent(basePath)}`);
  },

  async setDefaultModel(providerId: string, modelId: string): Promise<void> {
    await http.put('/v1/config/agents.defaults.model.primary', {
      value: `${normalizeId(providerId)}/${modelId}`,
    });
  },

  async testConnection(providerId: string, modelId: string): Promise<{ success: boolean; error?: string; content?: string }> {
    return http.post('/v1/models/test', { providerId, modelId });
  },

  async syncPricing(sourceUrl?: string): Promise<{ success: boolean; count?: number; error?: string }> {
    return http.post('/v1/models/pricing/sync', sourceUrl ? { source: sourceUrl } : {});
  },

  async reloadConfig(): Promise<{ success: boolean; error?: string }> {
    return http.post('/v1/config/reload', {});
  },

  async saveModelOverride(modelId: string, overrides: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(overrides)) {
      await http.put(`/v1/config/models.overrides.${encodeURIComponent(modelId)}.${key}`, { value });
    }
  },

  async deleteModelOverride(modelId: string): Promise<void> {
    await http.delete(`/v1/config/models.overrides.${encodeURIComponent(modelId)}`);
  },

  async exportConfig(): Promise<Record<string, unknown>> {
    return http.get<Record<string, unknown>>('/v1/config');
  },

  async importConfig(config: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
          await http.put(`/v1/config/${encodeURIComponent(key)}.${encodeURIComponent(subKey)}`, { value: subValue });
        }
      } else {
        await http.put(`/v1/config/${encodeURIComponent(key)}`, { value });
      }
    }
  },
};
