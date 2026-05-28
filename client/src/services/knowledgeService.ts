import type { KnowledgeItem } from '../types';
import { http } from './httpClient';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

async function tryTauri<T>(method: string, args?: Record<string, unknown>): Promise<T | null> {
  const core = await getTauriCore();
  if (!core) return null;
  try {
    return await core.invoke<T>(method, args);
  } catch {
    return null;
  }
}

function createMemoryKnowledgeService() {
  const items: KnowledgeItem[] = [];
  return {
    list: async (): Promise<KnowledgeItem[]> => [...items],
    get: async (_id: string): Promise<KnowledgeItem | null> => items.find(i => i.id === _id) || null,
    create: async (item: Omit<KnowledgeItem, 'id' | 'created_at' | 'updated_at'>): Promise<KnowledgeItem> => {
      const now = Date.now();
      const newItem: KnowledgeItem = {
        ...item,
        id: `mem-${now}`,
        created_at: now,
        updated_at: now,
      };
      items.push(newItem);
      return newItem;
    },
    update: async (id: string, updates: Partial<KnowledgeItem>): Promise<KnowledgeItem> => {
      const idx = items.findIndex(i => i.id === id);
      if (idx === -1) throw new Error(`Knowledge item ${id} not found`);
      items[idx] = { ...items[idx], ...updates, updated_at: Date.now() };
      return items[idx];
    },
    delete: async (_id: string): Promise<void> => {
      const idx = items.findIndex(i => i.id === _id);
      if (idx !== -1) items.splice(idx, 1);
    },
    search: async (_query: string): Promise<KnowledgeItem[]> => {
      const q = _query.toLowerCase();
      return items.filter(i =>
        (i.title && i.title.toLowerCase().includes(q)) ||
        (i.content && i.content.toLowerCase().includes(q))
      );
    },
  };
}

export const knowledgeService = {
  list: async (): Promise<KnowledgeItem[]> => {
    try {
      return await http.get<KnowledgeItem[]>('/v1/knowledge');
    } catch {
      const result = await tryTauri<KnowledgeItem[]>('list_knowledge');
      if (result) return result;
      return createMemoryKnowledgeService().list();
    }
  },

  get: async (id: string): Promise<KnowledgeItem | null> => {
    try {
      return await http.get<KnowledgeItem | null>(`/v1/knowledge/${id}`);
    } catch {
      const result = await tryTauri<KnowledgeItem | null>('get_knowledge', { id });
      if (result !== null) return result;
      return createMemoryKnowledgeService().get(id);
    }
  },

  create: async (item: Omit<KnowledgeItem, 'id' | 'created_at' | 'updated_at'>): Promise<KnowledgeItem> => {
    try {
      return await http.post<KnowledgeItem>('/v1/knowledge', item);
    } catch {
      const result = await tryTauri<KnowledgeItem>('create_knowledge', { item });
      if (result) return result;
      return createMemoryKnowledgeService().create(item);
    }
  },

  update: async (id: string, updates: Partial<KnowledgeItem>): Promise<KnowledgeItem> => {
    try {
      return await http.put<KnowledgeItem>(`/v1/knowledge/${id}`, updates);
    } catch {
      const result = await tryTauri<KnowledgeItem>('update_knowledge', { id, updates });
      if (result) return result;
      return createMemoryKnowledgeService().update(id, updates);
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      await http.delete<void>(`/v1/knowledge/${id}`);
    } catch {
      const result = await tryTauri<void>('delete_knowledge', { id });
      if (result !== null) return;
      return createMemoryKnowledgeService().delete(id);
    }
  },

  search: async (query: string): Promise<KnowledgeItem[]> => {
    try {
      return await http.post<KnowledgeItem[]>('/v1/knowledge/search', { query });
    } catch {
      const result = await tryTauri<KnowledgeItem[]>('search_knowledge', { query });
      if (result) return result;
      return createMemoryKnowledgeService().search(query);
    }
  },
};
