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

function createMemoryConfigService() {
  const store: Record<string, unknown> = {};

  return {
    get: async (key: string): Promise<unknown> => store[key] ?? null,
    set: async (key: string, value: unknown): Promise<void> => {
      store[key] = value;
    },
    list: async (): Promise<Record<string, unknown>> => ({ ...store }),
  };
}

export const configService = {
  get: async (key: string): Promise<unknown> => {
    try {
      return await http.get<unknown>(`/v1/config/${key}`);
    } catch {
      const result = await tryTauri<unknown>('get_config', { key });
      if (result !== null) return result;
      return createMemoryConfigService().get(key);
    }
  },

  set: async (key: string, value: unknown): Promise<void> => {
    try {
      await http.put<void>(`/v1/config/${key}`, { value });
    } catch {
      const result = await tryTauri<void>('set_config', { key, value });
      if (result !== null) return;
      return createMemoryConfigService().set(key, value);
    }
  },

  list: async (): Promise<Record<string, unknown>> => {
    try {
      return await http.get<Record<string, unknown>>('/v1/config');
    } catch {
      const result = await tryTauri<Record<string, unknown>>('list_config');
      if (result) return result;
      return createMemoryConfigService().list();
    }
  },
};
