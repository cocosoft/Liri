import { httpLegacy as http } from "./httpClient";
import { getBackendBaseUrl } from "./backendUrl";

export type MemoryType =
  | "user_preference"
  | "project_context"
  | "conversation"
  | "knowledge"
  | "system";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  summary: string;
  weight: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
  matchedContent: string;
}

export interface MemoryWeight {
  type: MemoryType;
  count: number;
  totalWeight: number;
  averageWeight: number;
}

export interface MemorySyncStatus {
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingChanges: number;
  syncProgress: number;
}

/** v1.2: 记忆系统运行状态（替代 MemorySyncStatus） */
export interface MemorySystemStats {
  totalMemories: number;
  withVectors: number;
  byType: Record<string, number>;
  recentCount: number;
  aging: {
    expiringCount: number;
    oldestMemoryAge: number;
    lastCleanupAt: number | null;
  };
  index: {
    indexedCount: number;
    vectorCacheSize: number;
  };
}

export interface MemorySearchParams {
  query: string;
  type?: MemoryType;
  limit?: number;
  offset?: number;
}

export interface MemoryListParams {
  type?: MemoryType;
  sortBy?: "createdAt" | "updatedAt" | "weight";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

interface BackendSummary {
  id: string;
  contentPreview: string;
  type: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface BackendMemory {
  id: string;
  content: string;
  metadata: {
    name: string;
    description: string;
    type: string;
    tags: string[];
    priority?: number;
    createdAt: string;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

function toClientMemory(m: BackendMemory): Memory {
  return {
    id: m.id,
    type: (m.metadata.type as MemoryType) || "knowledge",
    content: m.content,
    summary:
      m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content,
    weight: typeof m.metadata.priority === 'number' ? Math.max(1, m.metadata.priority) : 1,
    createdAt: new Date(m.createdAt).getTime(),
    updatedAt: new Date(m.updatedAt).getTime(),
    tags: m.metadata.tags || [],
    metadata: m.metadata as unknown as Record<string, unknown>,
  };
}

const memoryService = {
  async list(
    params?: MemoryListParams,
  ): Promise<{ memories: Memory[]; total: number }> {
    const url = new URL("/v1/memory", getBackendBaseUrl());
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    const response = await http.get<{
      success: boolean;
      memories: BackendMemory[];
    }>(url.pathname + url.search);
    const memories = (response.memories || []).map(toClientMemory);
    return { memories, total: memories.length };
  },

  async get(id: string): Promise<Memory> {
    const response = await http.get<{
      success: boolean;
      memory: BackendMemory;
    }>(`/v1/memory/${id}`);
    return toClientMemory(response.memory);
  },

  async create(
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt">,
  ): Promise<Memory> {
    const response = await http.post<{
      success: boolean;
      memory: BackendMemory;
    }>("/v1/memory", memory);
    return toClientMemory(response.memory);
  },

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const response = await http.put<{
      success: boolean;
      memory: BackendMemory;
    }>(`/v1/memory/${id}`, updates);
    return toClientMemory(response.memory);
  },

  async delete(id: string): Promise<void> {
    await http.delete<{ success: boolean }>(`/v1/memory/${id}`);
  },

  async deleteAll(): Promise<number> {
    const response = await http.delete<{
      success: boolean;
      deletedCount: number;
    }>("/v1/memory");
    return response.deletedCount;
  },

  async search(
    params: MemorySearchParams,
  ): Promise<{ results: MemorySearchResult[]; total: number }> {
    const url = new URL("/v1/memory/search", getBackendBaseUrl());
    if (params.query) url.searchParams.set("query", params.query);
    if (params.type) url.searchParams.set("type", params.type);
    if (params.limit) url.searchParams.set("limit", String(params.limit));
    if (params.offset) url.searchParams.set("offset", String(params.offset));
    const response = await http.get<{
      success: boolean;
      memories: BackendMemory[];
    }>(url.pathname + url.search);
    const results: MemorySearchResult[] = (response.memories || []).map((m) => {
      const memory = toClientMemory(m);
      return {
        memory,
        score: 1,
        matchedContent: m.content.slice(0, 100),
      };
    });
    return { results, total: results.length };
  },

  async getSummary(id: string): Promise<BackendSummary> {
    const response = await http.get<{
      success: boolean;
      summary: BackendSummary;
    }>(`/v1/memory/${id}/summary`);
    return response.summary;
  },

  async getWeights(): Promise<MemoryWeight[]> {
    const response = await http.get<{
      success: boolean;
      weights: MemoryWeight[];
    }>("/v1/memory/weights");
    return response.weights || [];
  },

  async getStats(): Promise<MemorySystemStats> {
    const response = await http.get<{
      success: boolean;
      stats: MemorySystemStats;
    }>("/v1/memory/stats");
    return response.stats;
  },

  async triggerCleanup(): Promise<{ cleanedCount: number; remainingCount: number }> {
    const response = await http.post<{
      success: boolean;
      result: { cleanedCount: number; remainingCount: number; reindexed: boolean };
    }>("/v1/memory/sync");
    return { cleanedCount: response.result.cleanedCount, remainingCount: response.result.remainingCount };
  },

  async triggerConsolidate(): Promise<{ duplicateGroups: number; totalRemoved: number; removedIds: string[] }> {
    const response = await http.post<{
      success: boolean;
      result: { duplicateGroups: number; totalRemoved: number; spaceSaved: number; removedIds: string[] };
    }>("/v1/memory/consolidate");
    return { duplicateGroups: response.result.duplicateGroups, totalRemoved: response.result.totalRemoved, removedIds: response.result.removedIds };
  },
};

export { memoryService };
