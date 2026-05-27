import type { KnowledgeItem } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

function createFallbackKnowledgeService() {
  return {
    list: async (): Promise<KnowledgeItem[]> => {
      return [];
    },
    get: async (_id: string): Promise<KnowledgeItem | null> => {
      return null;
    },
    delete: async (_id: string): Promise<void> => {},
    search: async (_query: string): Promise<KnowledgeItem[]> => {
      return [];
    },
  };
}

function createTauriKnowledgeService() {
  return {
    list: async (): Promise<KnowledgeItem[]> => {
      const core = await getTauriCore();
      if (!core) return createFallbackKnowledgeService().list();
      return core.invoke<KnowledgeItem[]>('list_knowledge');
    },
    get: async (id: string): Promise<KnowledgeItem | null> => {
      const core = await getTauriCore();
      if (!core) return createFallbackKnowledgeService().get(id);
      return core.invoke<KnowledgeItem | null>('get_knowledge', { id });
    },
    delete: async (id: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) return createFallbackKnowledgeService().delete(id);
      return core.invoke<void>('delete_knowledge', { id });
    },
    search: async (query: string): Promise<KnowledgeItem[]> => {
      const core = await getTauriCore();
      if (!core) return createFallbackKnowledgeService().search(query);
      return core.invoke<KnowledgeItem[]>('search_knowledge', { query });
    },
  };
}

export const knowledgeService = isTauri ? createTauriKnowledgeService() : createFallbackKnowledgeService();
