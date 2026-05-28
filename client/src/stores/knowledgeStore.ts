import { create } from 'zustand';
import type { KnowledgeItem } from '../types';
import { knowledgeService } from '../services/knowledgeService';

interface KnowledgeStore {
  items: KnowledgeItem[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  loadItems: () => Promise<void>;
  searchItems: (query: string) => Promise<void>;
  createItem: (item: Omit<KnowledgeItem, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
}

export const useKnowledgeStore = create<KnowledgeStore>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,
  searchQuery: '',

  loadItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await knowledgeService.list();
      set({ items, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  searchItems: async (query: string) => {
    set({ isLoading: true, error: null, searchQuery: query });
    try {
      const items = query.trim()
        ? await knowledgeService.search(query)
        : await knowledgeService.list();
      set({ items, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  createItem: async (item) => {
    try {
      const created = await knowledgeService.create(item);
      set({ items: [...get().items, created] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateItem: async (id, updates) => {
    try {
      const updated = await knowledgeService.update(id, updates);
      set({
        items: get().items.map((i) => (i.id === id ? updated : i)),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteItem: async (id: string) => {
    try {
      await knowledgeService.delete(id);
      set({ items: get().items.filter((i) => i.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
}));
