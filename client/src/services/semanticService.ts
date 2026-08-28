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
  /** KB-SEM（2026-08-27）：实际构建所用嵌入模型（来自索引 meta） */
  provider?: string;
  model?: string;
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

/** KB-SEM-P13：语义索引构建任务状态（异步构建 + 进度轮询） */
export interface SemanticBuildTask {
  id: string;
  status: "running" | "done" | "error";
  phase: string;
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  result?: IndexBuildResult;
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
      handleClientError(e, {
        module: "services:semantic",
        action: "getStatus",
      });
      return { exists: false, docCount: 0, chunkCount: 0 };
    }
  },

  /**
   * 启动语义索引构建（异步任务，立即返回 taskId，前端轮询 getBuildTask 查看进度）
   * KB-SEM-P13：原 buildIndex 同步阻塞——大目录构建数分钟，HTTP 超时后误报失败
   */
  startBuild: async (rootDir?: string): Promise<string | null> => {
    try {
      const res = await http.post<{ taskId: string }>("/v1/semantic/index", {
        rootDir: rootDir || "",
        incremental: true,
      });
      return res?.taskId ?? null;
    } catch (e) {
      handleClientError(e, {
        module: "services:semantic",
        action: "startBuild",
      });
      return null;
    }
  },

  /** 查询语义索引构建任务进度 */
  getBuildTask: async (taskId: string): Promise<SemanticBuildTask | null> => {
    try {
      const res = await http.get<SemanticBuildTask>(
        `/v1/semantic/index/task?taskId=${encodeURIComponent(taskId)}`,
      );
      return (res ?? null) as SemanticBuildTask | null;
    } catch (e) {
      handleClientError(e, {
        module: "services:semantic",
        action: "getBuildTask",
      });
      return null;
    }
  },

  /** 清除语义索引 */
  clearIndex: async (): Promise<boolean> => {
    try {
      await http.delete("/v1/semantic/index");
      return true;
    } catch (e) {
      handleClientError(e, {
        module: "services:semantic",
        action: "clearIndex",
      });
      return false;
    }
  },

  /**
   * 语义搜索。返回 null 表示搜索失败（嵌入服务不可用/维度不匹配等），
   * 空数组表示确实无匹配结果——调用方可区分，不再误报"无搜索结果"
   * KB-SEM-P2-1（2026-08-28）
   */
  search: async (
    query: string,
    topK: number = 10,
  ): Promise<SemanticSearchResult[] | null> => {
    try {
      const res = await http.get<SemanticSearchResult[]>(
        `/v1/semantic/search?q=${encodeURIComponent(query)}&topK=${topK}`,
      );
      if (Array.isArray(res)) return res as SemanticSearchResult[];
      // 兼容包装响应格式 { data: [...] }
      if (res && typeof res === "object" && "data" in res) {
        const wrapped = res as unknown as { data: SemanticSearchResult[] };
        if (Array.isArray(wrapped.data)) return wrapped.data;
      }
      return [];
    } catch (e) {
      handleClientError(e, { module: "services:semantic", action: "search" });
      return null;
    }
  },
};
