/**
 * 模型管理扩展 API 服务层
 * 保留定价同步、模型覆盖、配置重载等非 Provider CRUD 的方法。
 * Provider CRUD 已迁移到 providerService.ts。
 */

import { httpLegacy as http } from "./httpClient";

export const modelAdminService = {
  async testConnection(
    modelId: string,
  ): Promise<{ success: boolean; error?: string; content?: string }> {
    return http.post("/v1/models/test", { modelId });
  },

  async syncPricing(
    sourceUrl?: string,
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    return http.post(
      "/v1/models/pricing/sync",
      sourceUrl ? { source: sourceUrl } : {},
    );
  },

  async reloadConfig(): Promise<{ success: boolean; error?: string }> {
    return http.post("/v1/config/reload", {});
  },

  async saveModelOverride(
    modelId: string,
    overrides: Record<string, unknown>,
  ): Promise<void> {
    for (const [key, value] of Object.entries(overrides)) {
      await http.put(
        `/v1/config/models.overrides.${encodeURIComponent(modelId)}.${key}`,
        { value },
      );
    }
  },

  async deleteModelOverride(modelId: string): Promise<void> {
    await http.delete(
      `/v1/config/models.overrides.${encodeURIComponent(modelId)}`,
    );
  },
};
