import type { GraphEdgesResponse, GraphStats } from "../types/graph";
import { http } from "./httpClient";

function unwrap<T>(res: { ok: boolean; data?: T; error?: { code: number; message: string } }, action: string): T {
  if (!res.ok) throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

export const graphService = {
  /** 查询图谱边列表 */
  listEdges: async (params?: { domain?: string; entityId?: string; type?: string; limit?: number }): Promise<GraphEdgesResponse> => {
    const sp = new URLSearchParams();
    if (params?.domain) sp.set("domain", params.domain);
    if (params?.entityId) sp.set("entityId", params.entityId);
    if (params?.type) sp.set("type", params.type);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const url = qs ? `/v1/knowledge/graph/edges?${qs}` : "/v1/knowledge/graph/edges";
    const res = await http.get<GraphEdgesResponse>(url);
    return unwrap(res, "GRAPH_LIST");
  },

  /** 获取图统计 */
  getStats: async (): Promise<GraphStats> => {
    const res = await http.get<GraphStats>("/v1/knowledge/graph/stats");
    return unwrap(res, "GRAPH_STATS");
  },
};
