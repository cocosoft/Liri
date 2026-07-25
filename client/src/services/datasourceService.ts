import { http } from "./httpClient";

function unwrap<T>(res: { ok: boolean; data?: T; error?: { code: number; message: string } }, action: string): T {
  if (!res.ok) throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

export interface DataSourceConfig {
  type: string;
  url: string;
  enabled: boolean;
  intervalMs: number;
  maxItems?: number;
  knowledgeBase?: string;
  createdAt: number;
}

export interface SyncResult {
  connector: string;
  added: number;
  updated: number;
  failed: number;
  errors: Array<{ item: string; error: string }>;
  startedAt: number;
  completedAt: number;
}

export const datasourceService = {
  list: async (): Promise<DataSourceConfig[]> => {
    const res = await http.get<DataSourceConfig[]>("/v1/knowledge/datasources");
    return unwrap(res, "DS_LIST");
  },

  create: async (entry: Omit<DataSourceConfig, "createdAt">): Promise<DataSourceConfig> => {
    const res = await http.post<DataSourceConfig>("/v1/knowledge/datasources", entry);
    return unwrap(res, "DS_CREATE");
  },

  delete: async (type: string): Promise<void> => {
    const res = await http.delete<unknown>(`/v1/knowledge/datasources/${type}`);
    unwrap(res, "DS_DELETE");
  },

  sync: async (type: string): Promise<SyncResult> => {
    const res = await http.post<SyncResult>(`/v1/knowledge/datasources/${type}/sync`);
    return unwrap(res, "DS_SYNC");
  },
};
