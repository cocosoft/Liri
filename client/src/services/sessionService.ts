import type { Session } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function getTauriCore() {
  if (!isTauri) {
    return null;
  }
  try {
    return await import('@tauri-apps/api/core');
  } catch {
    return null;
  }
}

function createFallbackSessionService() {
  return {
    list: async (): Promise<Session[]> => {
      return [];
    },
    create: async (title: string): Promise<Session> => {
      return {
        id: `local-${Date.now()}`,
        title,
        created_at: Date.now(),
        last_modified_at: Date.now(),
        message_count: 0,
      };
    },
    switch: async (_id: string): Promise<void> => {},
    delete: async (_id: string): Promise<void> => {},
    rename: async (_id: string, _title: string): Promise<void> => {},
    getCurrent: async (): Promise<Session | null> => {
      return null;
    },
  };
}

function createTauriSessionService() {
  return {
    list: async (): Promise<Session[]> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackSessionService().list();
      }
      return core.invoke<Session[]>('list_sessions');
    },
    create: async (title: string): Promise<Session> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackSessionService().create(title);
      }
      return core.invoke<Session>('create_session', { title });
    },
    switch: async (id: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackSessionService().switch(id);
      }
      return core.invoke<void>('switch_session', { id });
    },
    delete: async (id: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackSessionService().delete(id);
      }
      return core.invoke<void>('delete_session', { id });
    },
    rename: async (id: string, title: string): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackSessionService().rename(id, title);
      }
      return core.invoke<void>('rename_session', { id, title });
    },
    getCurrent: async (): Promise<Session | null> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackSessionService().getCurrent();
      }
      return core.invoke<Session | null>('get_current_session');
    },
  };
}

export const sessionService = isTauri ? createTauriSessionService() : createFallbackSessionService();
