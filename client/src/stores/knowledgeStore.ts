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
