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

  // 批量操作
  selectedIds: Set<string>;
  isBatchMode: boolean;

  // 导入
  isImporting: boolean;

  // Dream
  isDreaming: boolean;
  dreamBusyMessage: string | null;

  loadMemories: (params?: MemoryListParams) => Promise<void>;
  searchMemories: (params: MemorySearchParams) => Promise<void>;
  getMemory: (id: string) => Promise<void>;
  createMemory: (
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt">,
  ) => Promise<Memory | null>;
  updateMemory: (id: string, updates: Partial<Memory>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  deleteAllMemories: () => Promise<number>;
  loadWeights: () => Promise<void>;
  loadSystemStats: () => Promise<void>;
  triggerCleanup: () => Promise<{
    cleanedCount: number;
    remainingCount: number;
  }>;
  triggerConsolidate: () => Promise<{
    duplicateGroups: number;
    totalRemoved: number;
    removedIds: string[];
  }>;
  setSelectedMemory: (memory: Memory | null) => void;
  clearError: () => void;

  // 批量操作
  toggleSelectMemory: (id: string) => void;
  selectAllMemories: () => void;
  clearSelection: () => void;
  batchDelete: () => Promise<number>;

  // 置顶
  togglePinMemory: (id: string) => Promise<void>;

  // 导入导出
  importFromFile: (
    filePath: string,
    name?: string,
    tags?: string[],
  ) => Promise<Memory | null>;
  exportAllAsJson: () => Promise<void>;

  // Dream
  triggerDream: () => Promise<{
    groupsProcessed: number;
    originalCount: number;
    refinedCount: number;
    details: Array<{
      type: string;
      original: number;
      refined: number;
      mergedPairs: number;
    }>;
  } | null>;
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
  selectedIds: new Set<string>(),
  isBatchMode: false,
  isImporting: false,

  // Dream
  isDreaming: false,
  dreamBusyMessage: null,

  loadMemories: async (params) => {
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
      handleClientError(e, {
        module: "stores:memory",
        action: "searchMemories",
      });
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
      const result = await memoryService.create(memory);
      return result;
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "createMemory" });
      set({ error: e instanceof Error ? e.message : "创建记忆失败" });
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  updateMemory: async (id, updates) => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.update(id, updates);
      // 更新本地列表中的记忆
      const memories = get().memories.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      );
      set({ memories });
      if (get().selectedMemory?.id === id) {
        set({
          selectedMemory: { ...get().selectedMemory!, ...updates },
        });
      }
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
      // 从本地列表中移除
      const memories = get().memories.filter((m) => m.id !== id);
      const selectedIds = new Set(get().selectedIds);
      selectedIds.delete(id);
      set({
        memories,
        total: get().total - 1,
        selectedIds,
        selectedMemory:
          get().selectedMemory?.id === id ? null : get().selectedMemory,
      });
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
      set({
        memories: [],
        total: 0,
        selectedMemory: null,
        selectedIds: new Set(),
        isBatchMode: false,
      });
      return count;
    } catch (e) {
      handleClientError(e, {
        module: "stores:memory",
        action: "deleteAllMemories",
      });
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
      handleClientError(e, {
        module: "stores:memory",
        action: "loadSystemStats",
      });
      set({ error: e instanceof Error ? e.message : "获取系统状态失败" });
    }
  },

  triggerCleanup: async () => {
    set({ isCleaning: true, error: null });
    try {
      const result = await memoryService.triggerCleanup();
      await get().loadSystemStats();
      return result;
    } catch (e) {
      handleClientError(e, {
        module: "stores:memory",
        action: "triggerCleanup",
      });
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
      handleClientError(e, {
        module: "stores:memory",
        action: "triggerConsolidate",
      });
      set({ error: e instanceof Error ? e.message : "合并重复记忆失败" });
      return { duplicateGroups: 0, totalRemoved: 0, removedIds: [] };
    } finally {
      set({ isConsolidating: false });
    }
  },

  // Dream
  triggerDream: async () => {
    set({ isDreaming: true, error: null, dreamBusyMessage: null });
    try {
      const result = await memoryService.triggerDream();
      await get().loadMemories({ sortBy: "updatedAt", sortOrder: "desc" });
      await get().loadWeights();
      await get().loadSystemStats();
      return result;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // 409: 梦境周期正在进行中
      if (errMsg.includes("409") || errMsg.includes("正在进行")) {
        set({ dreamBusyMessage: "梦境周期正在进行中，请稍后再试" });
        return null;
      }
      handleClientError(e, { module: "stores:memory", action: "triggerDream" });
      set({ error: e instanceof Error ? e.message : "记忆精炼失败" });
      return null;
    } finally {
      set({ isDreaming: false });
    }
  },

  setSelectedMemory: (memory) => set({ selectedMemory: memory }),

  clearError: () => set({ error: null }),

  // 批量操作

  toggleSelectMemory: (id) => {
    const selectedIds = new Set(get().selectedIds);
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    set({ selectedIds, isBatchMode: selectedIds.size > 0 });
  },

  selectAllMemories: () => {
    const ids = get().memories.map((m) => m.id);
    set({ selectedIds: new Set(ids), isBatchMode: ids.length > 0 });
  },

  clearSelection: () => {
    set({ selectedIds: new Set(), isBatchMode: false });
  },

  batchDelete: async () => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return 0;
    set({ isLoading: true, error: null });
    let count = 0;
    for (const id of ids) {
      try {
        await memoryService.delete(id);
        count++;
      } catch (e) {
        handleClientError(e, {
          module: "stores:memory",
          action: "batchDelete",
        });
      }
    }
    const memories = get().memories.filter((m) => !get().selectedIds.has(m.id));
    set({
      memories,
      total: get().total - count,
      selectedIds: new Set(),
      isBatchMode: false,
      isLoading: false,
    });
    await get().loadSystemStats();
    return count;
  },

  // 置顶

  togglePinMemory: async (id) => {
    const memory = get().memories.find((m) => m.id === id);
    if (!memory) return;
    const isPinned = !(memory.metadata?.isPinned as boolean);
    try {
      await memoryService.update(id, {
        metadata: { ...memory.metadata, isPinned },
      } as Partial<Memory>);
      const memories = get().memories.map((m) =>
        m.id === id ? { ...m, metadata: { ...m.metadata, isPinned } } : m,
      );
      set({ memories });
      if (get().selectedMemory?.id === id) {
        set({
          selectedMemory: {
            ...get().selectedMemory!,
            metadata: { ...get().selectedMemory!.metadata, isPinned },
          },
        });
      }
    } catch (e) {
      handleClientError(e, { module: "stores:memory", action: "togglePin" });
    }
  },

  // 导入导出

  importFromFile: async (filePath, name, tags) => {
    set({ isImporting: true, error: null });
    try {
      const memory = await memoryService.createFromFile(filePath, name, tags);
      await get().loadMemories();
      await get().loadSystemStats();
      return memory;
    } catch (e) {
      handleClientError(e, {
        module: "stores:memory",
        action: "importFromFile",
      });
      set({ error: e instanceof Error ? e.message : "导入记忆失败" });
      return null;
    } finally {
      set({ isImporting: false });
    }
  },

  exportAllAsJson: async () => {
    set({ isLoading: true, error: null });
    try {
      await memoryService.exportAllAsJson();
    } catch (e) {
      handleClientError(e, {
        module: "stores:memory",
        action: "exportAllAsJson",
      });
      set({ error: e instanceof Error ? e.message : "导出记忆失败" });
    } finally {
      set({ isLoading: false });
    }
  },
}));

export { memoryService } from "../services/memoryService";
