/**
 * Knowledge Store — 独立 Zustand Store
 *
 * 管理知识库条目（KnowledgeItem）的 CRUD 操作和加载状态。
 */
import { create } from "zustand";
import { knowledgeService } from "../services/knowledgeService";
import { handleClientError } from "@/utils/handleError";
import type { KnowledgeItem } from "../types";

export type { KnowledgeItem };

interface KnowledgeStore {
  items: KnowledgeItem[];
  isLoading: boolean;
  error: string | null;

  loadItems: () => Promise<void>;
  createItem: (
    item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">,
  ) => Promise<void>;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

export const useKnowledgeStore = create<KnowledgeStore>()((set) => ({
  items: [],
  isLoading: false,
  error: null,

  loadItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await knowledgeService.list();
      set({ items, isLoading: false });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "loadItems" },
        "warn",
      );
      set({ error: String(e), isLoading: false });
    }
  },

  createItem: async (item) => {
    try {
      const created = await knowledgeService.create(item);
      set((state) => ({ items: [...state.items, created] }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "createItem" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  updateItem: async (id, updates) => {
    try {
      const updated = await knowledgeService.update(id, updates);
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? updated : i)),
      }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "updateItem" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  deleteItem: async (id) => {
    try {
      await knowledgeService.delete(id);
      set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "deleteItem" },
        "warn",
      );
      set({ error: String(e) });
    }
  },
}));
