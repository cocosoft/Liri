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
  // 1. USERPROFILE 环境变量
  // 2. HOMEDRIVE + HOMEPATH 组合
  // 3. 抛出明确错误（绝不回退到 C:\Users\Default，那是系统保护的模板目录，不可写）
  let homeDir: string;
  if (typeof process !== "undefined" && process.env?.USERPROFILE) {
    homeDir = process.env.USERPROFILE;
  } else if (
    typeof process !== "undefined" &&
    process.env?.HOMEDRIVE &&
    process.env?.HOMEPATH
  ) {
    homeDir = process.env.HOMEDRIVE + process.env.HOMEPATH;
  } else {
    throw new Error(
      "无法解析用户主目录。请设置 USERPROFILE 或 HOMEDRIVE+HOMEPATH 环境变量。",
    );
  }

  return {
    dataDir: `${homeDir}\\.pyapp`,
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
      handleClientError(e, { module: "services:appConfig", action: "isFirstRun" });
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
