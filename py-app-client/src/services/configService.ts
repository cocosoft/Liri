// 检查是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

// 安全导入 Tauri API
async function getTauriCore() {
  if (!isTauri) {
    return null;
  }
  try {
    const core = await import('@tauri-apps/api/core');
    return core;
  } catch (e) {
    console.error('Failed to load Tauri core:', e);
    return null;
  }
}

// 创建 mock config service
function createMockConfigService() {
  const mockConfig: Record<string, unknown> = {
    theme: 'light',
    model: 'gpt-4',
    temperature: 0.7,
  };

  return {
    get: async (key: string): Promise<unknown> => {
      console.warn('Mock: configService.get called', { key });
      return Promise.resolve(mockConfig[key]);
    },
    set: async (key: string, value: unknown): Promise<void> => {
      console.warn('Mock: configService.set called', { key, value });
      mockConfig[key] = value;
      return Promise.resolve();
    },
    list: async (): Promise<Record<string, unknown>> => {
      console.warn('Mock: configService.list called');
      return Promise.resolve({ ...mockConfig });
    },
  };
}

// 创建实际 Tauri config service
function createTauriConfigService() {
  return {
    get: async (key: string): Promise<unknown> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockConfigService().get(key);
      }
      return core.invoke<unknown>('get_config', { key });
    },
    set: async (key: string, value: unknown): Promise<void> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockConfigService().set(key, value);
      }
      return core.invoke<void>('set_config', { key, value });
    },
    list: async (): Promise<Record<string, unknown>> => {
      const core = await getTauriCore();
      if (!core) {
        return createMockConfigService().list();
      }
      return core.invoke<Record<string, unknown>>('list_config');
    },
  };
}

export const configService = isTauri ? createTauriConfigService() : createMockConfigService();
