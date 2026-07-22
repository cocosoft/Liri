/**
 * 语义索引 API 服务
 * 对应后端 LocalHTTPService 中的 Semantic Index 处理器
 */
import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";

export interface SemanticIndexStatus {
  exists: boolean;
  docCount: number;
  chunkCount: number;
  lastIndexedAt?: number;
  sizeBytes?: number;
}

export interface SemanticSearchResult {
  chunkId: string;
  docId: string;
  title: string;
  content: string;
  score: number;
}

export interface IndexBuildResult {
  ok: boolean;
  chunkCount: number;
  embeddedCount: number;
  skippedCount: number;
  durationMs: number;
  indexDir: string;
  error?: string;
}

export const semanticService = {
  /** 获取语义索引状态 */
  getStatus: async (): Promise<SemanticIndexStatus> => {
    try {
      const res = await http.get<SemanticIndexStatus>(
        "/v1/semantic/index/status",
      );
      return (res ?? {
        exists: false,
        docCount: 0,
        chunkCount: 0,
      }) as SemanticIndexStatus;
    } catch (e) {
      handleClientError(e, { module: "services:semantic", action: "getStatus" });
      return { exists: false, docCount: 0, chunkCount: 0 };
    }
  },

  /** 构建语义索引 */
  buildIndex: async (rootDir?: string): Promise<IndexBuildResult | null> => {
    try {
      const res = await http.post<IndexBuildResult>("/v1/semantic/index", {
        rootDir: rootDir || "",
        incremental: true,
      });
      return (res ?? null) as IndexBuildResult | null;
    } catch (e) {
      handleClientError(e, { module: "services:semantic", action: "buildIndex" });
      return null;
    }
  },

  /** 清除语义索引 */
  clearIndex: async (): Promise<boolean> => {
    try {
      await http.delete("/v1/semantic/index");
      return true;
    } catch (e) {
      handleClientError(e, { module: "services:semantic", action: "clearIndex" });
      return false;
    }
  },

  /** 语义搜索 */
  search: async (
    query: string,
    topK: number = 10,
  ): Promise<SemanticSearchResult[]> => {
    try {
      const res = await http.get<SemanticSearchResult[]>(
        `/v1/semantic/search?q=${encodeURIComponent(query)}&topK=${topK}`,
      );
      if (Array.isArray(res)) return res as SemanticSearchResult[];
      if (res && Array.isArray((res as any).data))
        return (res as any).data as SemanticSearchResult[];
      return [];
    } catch (e) {
      handleClientError(e, { module: "services:semantic", action: "search" });
      return [];
    }
  },
};