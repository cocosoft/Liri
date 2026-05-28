import { create } from 'zustand';
import { memoryService, type Memory, type MemorySearchResult, type MemoryWeight, type MemorySyncStatus, type MemorySearchParams, type MemoryListParams } from '../services/memoryService';

interface MemoryStore {
  memories: Memory[];
  total: number;
  searchResults: MemorySearchResult[];
  searchTotal: number;
  weights: MemoryWeight[];
  syncStatus: MemorySyncStatus;
  selectedMemory: Memory | null;
  isLoading: boolean;
  error: string | null;

  loadMemories: (params?: MemoryListParams) => Promise<void>;
  searchMemories: (params: MemorySearchParams) => Promise<void>;
  getMemory: (id: string) => Promise<void>;
  createMemory: (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateMemory: (id: string, updates: Partial<Memory>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  loadWeights: () => Promise<void>;
  loadSyncStatus: () => Promise<void>;
  triggerSync: () => Promise<void>;
  setSelectedMemory: (memory: Memory | null) => void;
  clearError: () => void;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  memories: [],
  total: 0,
  searchResults: [],
  searchTotal: 0,
  weights: [],
  syncStatus: {
    isSyncing: false,
    lastSyncTime: null,
    pendingChanges: 0,
    syncProgress: 0,
  },
  selectedMemory: null,
  isLoading: false,
  error: null,

  loadMemories: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await memoryService.list(params);
      set({ memories: result.memories, total: result.total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取记忆列表失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  searchMemories: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await memoryService.search(params);
      set({ searchResults: result.results, searchTotal: result.total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '搜索记忆失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  getMemory: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const memory = await memoryService.get(id);
      set({ selectedMemory: memory });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取记忆详情失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  createMemory: async (memory) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.create(memory);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '创建记忆失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  updateMemory: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.update(id, updates);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新记忆失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteMemory: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.delete(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除记忆失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  loadWeights: async () => {
    try {
      const weights = await memoryService.getWeights();
      set({ weights });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取权重分布失败' });
    }
  },

  loadSyncStatus: async () => {
    try {
      const status = await memoryService.getSyncStatus();
      set({ syncStatus: status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取同步状态失败' });
    }
  },

  triggerSync: async () => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.triggerSync();
      await memoryService.getSyncStatus();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '触发同步失败' });
    } finally {
      set({ isLoading: false });
    }
  },

  setSelectedMemory: (memory) => set({ selectedMemory: memory }),

  clearError: () => set({ error: null }),
}));

export { memoryService } from '../services/memoryService';