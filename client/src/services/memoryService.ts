import { http } from './httpClient';

export type MemoryType = 'user_preference' | 'project_context' | 'conversation' | 'knowledge' | 'system';

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
  sortBy?: 'createdAt' | 'updatedAt' | 'weight';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const memoryService = {
  async list(params?: MemoryListParams): Promise<{ memories: Memory[]; total: number }> {
    const url = new URL('/api/memory/list', 'http://localhost');
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    const response = await http.get<{ memories: Memory[]; total: number }>(url.pathname + url.search);
    return response;
  },

  async get(id: string): Promise<Memory> {
    const response = await http.get<Memory>(`/api/memory/${id}`);
    return response;
  },

  async create(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const response = await http.post<Memory>('/api/memory', memory);
    return response;
  },

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const response = await http.put<Memory>(`/api/memory/${id}`, updates);
    return response;
  },

  async delete(id: string): Promise<void> {
    await http.delete(`/api/memory/${id}`);
  },

  async search(params: MemorySearchParams): Promise<{ results: MemorySearchResult[]; total: number }> {
    const url = new URL('/api/memory/search', 'http://localhost');
    if (params.query) url.searchParams.set('query', params.query);
    if (params.type) url.searchParams.set('type', params.type);
    if (params.limit) url.searchParams.set('limit', String(params.limit));
    if (params.offset) url.searchParams.set('offset', String(params.offset));
    const response = await http.get<{ results: MemorySearchResult[]; total: number }>(url.pathname + url.search);
    return response;
  },

  async getSummary(id: string): Promise<string> {
    const response = await http.get<{ summary: string }>(`/api/memory/${id}/summary`);
    return response.summary;
  },

  async getWeights(): Promise<MemoryWeight[]> {
    const response = await http.get<MemoryWeight[]>('/api/memory/weights');
    return response;
  },

  async getSyncStatus(): Promise<MemorySyncStatus> {
    const response = await http.get<MemorySyncStatus>('/api/memory/sync/status');
    return response;
  },

  async triggerSync(): Promise<void> {
    await http.post('/api/memory/sync/trigger');
  },

  async consolidate(): Promise<void> {
    await http.post('/api/memory/consolidate');
  },
};

export { memoryService };