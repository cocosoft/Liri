import { http } from "./httpClient";
import i18n from "../i18n";
import { ENDPOINTS } from "./endpoints";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(
      `[${action}] ${res.error?.message ?? i18n.t("errors.unknown")}`,
    );
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
    const res = await http.get<DataSourceConfig[]>(
      ENDPOINTS.knowledge.datasources,
    );
    return unwrap(res, "DS_LIST");
  },

  create: async (
    entry: Omit<DataSourceConfig, "createdAt">,
  ): Promise<DataSourceConfig> => {
    const res = await http.post<DataSourceConfig>(
      ENDPOINTS.knowledge.datasources,
      entry,
    );
    return unwrap(res, "DS_CREATE");
  },

  delete: async (type: string): Promise<void> => {
    const res = await http.delete<unknown>(
      ENDPOINTS.knowledge.datasourceByType(type),
    );
    unwrap(res, "DS_DELETE");
  },

  sync: async (type: string): Promise<SyncResult> => {
    const res = await http.post<SyncResult>(
      ENDPOINTS.knowledge.datasourceSync(type),
    );
    return unwrap(res, "DS_SYNC");
  },
};
