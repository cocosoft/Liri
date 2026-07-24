import { handleClientError } from "../utils/handleError";

export interface AppConfig {
  dataDir: string;
  httpPort: number;
  firstRunCompleted: boolean;
}

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

function defaultConfig(): AppConfig {
  // 解析用户主目录，优先级：
  // 1. USERPROFILE 环境变量（Node.js / Tauri 环境）
  // 2. HOMEDRIVE + HOMEPATH 组合（Node.js / Tauri 环境）
  // 3. 浏览器环境下使用空字符串（前端不需要知道用户主目录路径）
  let homeDir = "";
  if (typeof process !== "undefined" && process.env?.USERPROFILE) {
    homeDir = process.env.USERPROFILE;
  } else if (
    typeof process !== "undefined" &&
    process.env?.HOMEDRIVE &&
    process.env?.HOMEPATH
  ) {
    homeDir = process.env.HOMEDRIVE + process.env.HOMEPATH;
  }

  return {
    dataDir: homeDir ? `${homeDir}\\.pyapp` : "",
    httpPort: 7890,
    firstRunCompleted: false,
  };
}

async function invoke<T>(
  method: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) {
    throw new Error("Not in Tauri environment");
  }
  const core = await import("@tauri-apps/api/core");
  return await core.invoke<T>(method, args);
}

export const appConfigService = {
  async get(): Promise<AppConfig> {
    // 浏览器模式下直接返回默认配置，不上报错误
    if (!isTauri) {
      return defaultConfig();
    }

    try {
      const config = await invoke<AppConfig>("get_app_config");

      if (!config.dataDir) {
        const def = defaultConfig();
        config.dataDir = def.dataDir;
      }

      return config;
    } catch (e) {
      handleClientError(e, { module: "services:appConfig", action: "get" });
      return defaultConfig();
    }
  },

  async set(config: AppConfig): Promise<void> {
    if (!isTauri) return;
    await invoke("set_app_config", { config });
  },

  async isFirstRun(): Promise<boolean> {
    if (!isTauri) return false;
    try {
      const config = await this.get();
      return !config.firstRunCompleted;
    } catch (e) {
      handleClientError(e, {
        module: "services:appConfig",
        action: "isFirstRun",
      });
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
