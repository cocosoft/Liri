import type { KnowledgeConfigData } from "../types/config";
import { http } from "./httpClient";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

export const knowledgeConfigService = {
  /** 获取知识库配置 */
  get: async (): Promise<KnowledgeConfigData> => {
    const res = await http.get<KnowledgeConfigData>("/v1/knowledge/config");
    return unwrap(res, "CONFIG_GET");
  },

  /** 更新知识库配置 */
  update: async (
    partial: Partial<KnowledgeConfigData>,
  ): Promise<KnowledgeConfigData> => {
    const res = await http.put<KnowledgeConfigData>(
      "/v1/knowledge/config",
      partial,
    );
    return unwrap(res, "CONFIG_UPDATE");
  },
};
