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

function createFallbackConfigService() {
  const store: Record<string, unknown> = {};

  return {
    get: async (key: string): Promise<unknown> => {
      return store[key] ?? null;
    },
    set: async (key: string, value: unknown): Promise<void> => {
      store[key] = value;
    },
    list: async (): Promise<Record<string, unknown>> => {
      return { ...store };
    },
  };
}

function createTauriConfigService() {
  return {
    get: async (key: string): Promise<unknown> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackConfigService().get(key);
      }
      return core.invoke<unknown>('get_config', { key });
    },
    set: async (key: string, value: unknown): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackConfigService().set(key, value);
      }
      return core.invoke<void>('set_config', { key, value });
    },
    list: async (): Promise<Record<string, unknown>> => {
      const core = await getTauriCore();
      if (!core) {
        return createFallbackConfigService().list();
      }
      return core.invoke<Record<string, unknown>>('list_config');
    },
  };
}

export const configService = isTauri ? createTauriConfigService() : createFallbackConfigService();
