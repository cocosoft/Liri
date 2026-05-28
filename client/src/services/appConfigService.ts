export interface AppConfig {
  dataDir: string;
  httpPort: number;
  firstRunCompleted: boolean;
}

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

function defaultConfig(): AppConfig {
  const homeDir = typeof process !== 'undefined' && process.env?.USERPROFILE
    ? process.env.USERPROFILE
    : 'C:\\Users\\Default';

  return {
    dataDir: `${homeDir}\\.pyapp`,
    httpPort: 7890,
    firstRunCompleted: false,
  };
}

async function invoke<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    throw new Error('Not in Tauri environment');
  }
  const core = await import('@tauri-apps/api/core');
  return await core.invoke<T>(method, args);
}

export const appConfigService = {
  async get(): Promise<AppConfig> {
    try {
      const config = await invoke<AppConfig>('get_app_config');

      if (!config.dataDir) {
        const def = defaultConfig();
        config.dataDir = def.dataDir;
      }

      return config;
    } catch {
      return defaultConfig();
    }
  },

  async set(config: AppConfig): Promise<void> {
    if (!isTauri) return;
    await invoke('set_app_config', { config });
  },

  async isFirstRun(): Promise<boolean> {
    if (!isTauri) return false;
    try {
      const config = await this.get();
      return !config.firstRunCompleted;
    } catch {
      return true;
    }
  },

  async completeFirstRun(config: Partial<AppConfig>): Promise<void> {
    const existing = await this.get();
    await this.set({
      ...existing,
      ...config,
      firstRunCompleted: true,
    });
  },
};
