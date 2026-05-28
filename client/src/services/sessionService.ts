import type { Session } from '../types';
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

function createMemorySessionService() {
  return {
    list: async (): Promise<Session[]> => [],
    create: async (title: string): Promise<Session> => ({
      id: `local-${Date.now()}`,
      title,
      created_at: Date.now(),
      last_modified_at: Date.now(),
      message_count: 0,
    }),
    switch: async (_id: string): Promise<void> => {},
    delete: async (_id: string): Promise<void> => {},
    rename: async (_id: string, _title: string): Promise<void> => {},
    getCurrent: async (): Promise<Session | null> => null,
  };
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

export const sessionService = {
  list: async (): Promise<Session[]> => {
    try {
      return await http.get<Session[]>('/v1/sessions');
    } catch {
      const result = await tryTauri<Session[]>('list_sessions');
      if (result) return result;
      return createMemorySessionService().list();
    }
  },

  create: async (title: string): Promise<Session> => {
    try {
      return await http.post<Session>('/v1/sessions', { title });
    } catch {
      const result = await tryTauri<Session>('create_session', { title });
      if (result) return result;
      return createMemorySessionService().create(title);
    }
  },

  switch: async (id: string): Promise<void> => {
    try {
      await http.post<void>(`/v1/sessions/${id}/switch`);
    } catch {
      const result = await tryTauri<void>('switch_session', { id });
      if (result !== null) return;
      return createMemorySessionService().switch(id);
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      await http.delete<void>(`/v1/sessions/${id}`);
    } catch {
      const result = await tryTauri<void>('delete_session', { id });
      if (result !== null) return;
      return createMemorySessionService().delete(id);
    }
  },

  rename: async (id: string, title: string): Promise<void> => {
    try {
      await http.put<void>(`/v1/sessions/${id}`, { title });
    } catch {
      const result = await tryTauri<void>('rename_session', { id, title });
      if (result !== null) return;
      return createMemorySessionService().rename(id, title);
    }
  },

  getCurrent: async (): Promise<Session | null> => {
    try {
      return await http.get<Session | null>('/v1/sessions/current');
    } catch {
      const result = await tryTauri<Session | null>('get_current_session');
      if (result !== null) return result;
      return createMemorySessionService().getCurrent();
    }
  },
};
