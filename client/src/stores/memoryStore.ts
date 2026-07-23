import { create } from "zustand";
import {
  memoryService,
  type Memory,
  type MemorySearchResult,
  type MemoryWeight,
  type MemorySystemStats,
  type MemorySearchParams,
  type MemoryListParams,
} from "../services/memoryService";
import { handleClientError } from "@/utils/handleError";

interface MemoryStore {
  memories: Memory[];
  total: number;
  searchResults: MemorySearchResult[];
  searchTotal: number;
  weights: MemoryWeight[];
  systemStats: MemorySystemStats | null;
  selectedMemory: Memory | null;
  isCleaning: boolean;
  isConsolidating: boolean;
  isLoading: boolean;
  error: string | null;

  loadMemories: (params?: MemoryListParams) => Promise<void>;
  searchMemories: (params: MemorySearchParams) => Promise<void>;
  getMemory: (id: string) => Promise<void>;
  createMemory: (
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt">,
  ) => Promise<void>;
  updateMemory: (id: string, updates: Partial<Memory>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  deleteAllMemories: () => Promise<number>;
  loadWeights: () => Promise<void>;
  loadSystemStats: () => Promise<void>;
  triggerCleanup: () => Promise<{ cleanedCount: number; remainingCount: number }>;
  triggerConsolidate: () => Promise<{ duplicateGroups: number; totalRemoved: number; removedIds: string[] }>;
  setSelectedMemory: (memory: Memory | null) => void;
  clearError: () => void;
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  memories: [],
  total: 0,
  searchResults: [],
  searchTotal: 0,
  weights: [],
  systemStats: null,
  selectedMemory: null,
  isCleaning: false,
  isConsolidating: false,
  isLoading: false,
  error: null,

  loadMemories: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await memoryService.list(params);
      set({ memories: result.memories, total: result.total });
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "loadMemories" });
      set({ error: e instanceof Error ? e.message : "获取记忆列表失败" });
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
      handleClientError(e, { module: "stores:memory", action: "searchMemories" });
      set({ error: e instanceof Error ? e.message : "搜索记忆失败" });
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
      handleClientError(e, { module: "stores:memory", action: "getMemory" });
      set({ error: e instanceof Error ? e.message : "获取记忆详情失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  createMemory: async (memory) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.create(memory);
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "createMemory" });
      set({ error: e instanceof Error ? e.message : "创建记忆失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  updateMemory: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.update(id, updates);
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "updateMemory" });
      set({ error: e instanceof Error ? e.message : "更新记忆失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteMemory: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.delete(id);
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "deleteMemory" });
      set({ error: e instanceof Error ? e.message : "删除记忆失败" });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteAllMemories: async () => {
    set({ isLoading: true, error: null });
    try {
      const count = await memoryService.deleteAll();
      set({ memories: [], total: 0, selectedMemory: null });
      return count;
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "deleteAllMemories" });
      set({ error: e instanceof Error ? e.message : "清除全部记忆失败" });
      return 0;
    } finally {
      set({ isLoading: false });
    }
  },

  loadWeights: async () => {
    try {
      const weights = await memoryService.getWeights();
      set({ weights });
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "loadWeights" });
      set({ error: e instanceof Error ? e.message : "获取权重分布失败" });
    }
  },

  loadSystemStats: async () => {
    try {
      const stats = await memoryService.getStats();
      set({ systemStats: stats });
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "loadSystemStats" });
      set({ error: e instanceof Error ? e.message : "获取系统状态失败" });
    }
  },

  triggerCleanup: async () => {
    set({ isCleaning: true, error: null });
    try {
      const result = await memoryService.triggerCleanup();
      // v1.2: 修复遗留 bug — 清理后刷新 stats
      await get().loadSystemStats();
      return result;
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "triggerCleanup" });
      set({ error: e instanceof Error ? e.message : "清理过期记忆失败" });
      return { cleanedCount: 0, remainingCount: 0 };
    } finally {
      set({ isCleaning: false });
    }
  },

  triggerConsolidate: async () => {
    set({ isConsolidating: true, error: null });
    try {
      const result = await memoryService.triggerConsolidate();
      await get().loadSystemStats();
      return result;
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "triggerConsolidate" });
      set({ error: e instanceof Error ? e.message : "合并重复记忆失败" });
      return { duplicateGroups: 0, totalRemoved: 0, removedIds: [] };
    } finally {
      set({ isConsolidating: false });
    }
  },

  setSelectedMemory: (memory) => set({ selectedMemory: memory }),

  clearError: () => set({ error: null }),
}));

export { memoryService } from "../services/memoryService";
