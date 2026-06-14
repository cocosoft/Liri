import { httpLegacy as http } from "./httpClient";

/**
 * 配置服务
 * 提供键值对配置的读写，基于 HTTP API + 内存回退
 */

/** 内存回退存储（模块级单例） */
const memoryStore: Record<string, unknown> = {};

const memoryConfigService = {
  get: async (key: string): Promise<unknown> => memoryStore[key] ?? null,
  set: async (key: string, value: unknown): Promise<void> => {
    memoryStore[key] = value;
  },
  list: async (): Promise<Record<string, unknown>> => ({ ...memoryStore }),
};

export const configService = {
  /** 获取配置项 */
  get: async (key: string): Promise<unknown> => {
    try {
      return await http.get<unknown>(`/v1/config/${key}`);
    } catch {
      return memoryConfigService.get(key);
    }
  },

  /** 设置配置项 */
  set: async (key: string, value: unknown): Promise<void> => {
    try {
      await http.put<void>(`/v1/config/${key}`, { value });
    } catch {
      return memoryConfigService.set(key, value);
    }
  },

  /** 列出所有配置 */
  list: async (): Promise<Record<string, unknown>> => {
    try {
      return await http.get<Record<string, unknown>>("/v1/config");
    } catch {
      return memoryConfigService.list();
    }
  },
};
