/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { KnowledgeItem } from "../types";

export type { KnowledgeItem };

/** Knowledge 相关状态切片 */
interface KnowledgeSlice {
  items: KnowledgeItem[];
  isLoading: boolean;
  error: string | null;
  loadItems: () => Promise<void>;
  createItem: (item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">) => Promise<void>;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

function knowledgeSlice(state: { knowledgeItems: KnowledgeItem[]; knowledgeLoading: boolean; knowledgeError: string | null; loadKnowledge: () => Promise<void>; createKnowledge: (item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">) => Promise<void>; updateKnowledge: (id: string, updates: Partial<KnowledgeItem>) => Promise<void>; deleteKnowledge: (id: string) => Promise<void> }): KnowledgeSlice {
  return {
    items: state.knowledgeItems,
    isLoading: state.knowledgeLoading,
    error: state.knowledgeError,
    loadItems: state.loadKnowledge,
    createItem: state.createKnowledge,
    updateItem: state.updateKnowledge,
    deleteItem: state.deleteKnowledge,
  };
}

export function useKnowledgeStore(): KnowledgeSlice;
export function useKnowledgeStore<T>(selector: (slice: KnowledgeSlice) => T): T;
export function useKnowledgeStore<T>(selector?: (slice: KnowledgeSlice) => T): KnowledgeSlice | T {
  const slice = useAppStore((s) => ({
    items: s.knowledgeItems,
    isLoading: s.knowledgeLoading,
    error: s.knowledgeError,
    loadItems: s.loadKnowledge,
    createItem: s.createKnowledge,
    updateItem: s.updateKnowledge,
    deleteItem: s.deleteKnowledge,
  }));
  return selector ? selector(slice) : slice;
}

useKnowledgeStore.getState = () =>
  knowledgeSlice(useAppStore.getState() as Parameters<typeof knowledgeSlice>[0]);
useKnowledgeStore.setState = (partial: Partial<KnowledgeSlice>) => {
  useAppStore.setState({
    ...(partial.items !== undefined && { knowledgeItems: partial.items }),
    ...(partial.isLoading !== undefined && { knowledgeLoading: partial.isLoading }),
    ...(partial.error !== undefined && { knowledgeError: partial.error }),
  });
};
