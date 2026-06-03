import { http } from "./httpClient";

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

interface BackendMemoryWeight {
  semantic: number;
  recency: number;
  frequency: number;
}

interface BackendSyncStatus {
  lastSync: string | null;
  pendingSync: string[];
  failedSync: string[];
  syncCount: number;
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
    weight: 0,
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
    const url = new URL("/v1/memory", "http://localhost");
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
    const url = new URL("/v1/memory/search", "http://localhost");
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
      weights: BackendMemoryWeight;
    }>("/v1/memory/weights");
    const w = response.weights;
    const weights: MemoryWeight[] = [
      {
        type: "user_preference",
        count: 0,
        totalWeight: w.semantic,
        averageWeight: w.semantic,
      },
      {
        type: "conversation",
        count: 0,
        totalWeight: w.recency,
        averageWeight: w.recency,
      },
      {
        type: "knowledge",
        count: 0,
        totalWeight: w.frequency,
        averageWeight: w.frequency,
      },
    ];
    return weights;
  },

  async getSyncStatus(): Promise<MemorySyncStatus> {
    const response = await http.get<{
      success: boolean;
      status: BackendSyncStatus;
    }>("/v1/memory/sync-status");
    const s = response.status;
    return {
      isSyncing: s.pendingSync.length > 0,
      lastSyncTime: s.lastSync ? new Date(s.lastSync).getTime() : null,
      pendingChanges: s.pendingSync.length,
      syncProgress: s.syncCount > 0 ? 1 : 0,
    };
  },

  async triggerSync(): Promise<void> {
    await http.post("/v1/memory/sync");
  },

  async consolidate(): Promise<void> {
    await http.post("/v1/memory/consolidate");
  },
};

export { memoryService };
