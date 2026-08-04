import { create } from "zustand";
import { persist } from "zustand/middleware";
import { configService } from "../services/configService";
import { handleClientError } from "@/utils/handleError";

/** 聊天参数（SettingsTab 设置项） */
export interface ChatParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPrompt: string;
}

const DEFAULT_CHAT_PARAMS: ChatParams = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 8192,
  systemPrompt: "你是一个有帮助的AI助手，请用中文回答用户的问题。",
};

interface ConfigStore {
  config: Record<string, unknown>;
  chatParams: ChatParams;
  /** 会话级别的 chatParams 覆盖（sessionId → ChatParams） */
  sessionChatParams: Record<string, ChatParams>;
  isLoading: boolean;
  error: string | null;
  /** Phase 3.2: ConfigManager 数据是否已从后端加载完成 */
  configHydrated: boolean;
  loadConfig: () => Promise<void>;
  setConfig: (key: string, value: unknown) => Promise<void>;
  setChatParams: (params: ChatParams) => Promise<void>;
  /** 保存会话级别的 chatParams */
  setSessionChatParams: (sessionId: string, params: ChatParams) => void;
  /** 读取会话级别的 chatParams（优先 session，fallback global） */
  getEffectiveChatParams: (sessionId?: string) => ChatParams;
  /** 命名空间级设置写入（自动路由到对应后端） */
  setSettings: (
    namespace: string,
    values: Record<string, unknown>,
  ) => Promise<void>;
  /** 命名空间级设置读取 */
  getSettings: <T>(namespace: string) => Promise<T>;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      config: {},
      chatParams: { ...DEFAULT_CHAT_PARAMS },
      sessionChatParams: {},
      isLoading: false,
      error: null,
      configHydrated: false,

      loadConfig: async () => {
        set({ isLoading: true, error: null });
        try {
          const config = await configService.list();
          // 加载持久化的 chatParams（后端优先，本地 persist 兜底）
          const persistedParams = config["chat.params"] as
            ChatParams | undefined;
          set({
            config,
            chatParams: persistedParams ?? get().chatParams,
            isLoading: false,
            configHydrated: true,
          });
        } catch (error) {
          handleClientError(error, {
            module: "stores:config",
            action: "loadConfig",
          });
          set({ error: String(error), isLoading: false });
        }
      },

      setConfig: async (key: string, value: unknown) => {
        set({ isLoading: true, error: null });
        try {
          await configService.set(key, value);
          set({
            config: { ...get().config, [key]: value },
            isLoading: false,
          });
        } catch (error) {
          handleClientError(error, {
            module: "stores:config",
            action: "setConfig",
          });
          set({ error: String(error), isLoading: false });
        }
      },

      setChatParams: async (params: ChatParams) => {
        // 先更新 localStorage（persist 中间件自动处理）
        set({ chatParams: params });
        // 异步持久化到后端（失败不影响本地状态）
        configService.set("chat.params", params).catch(() => {
          // configService 内部有 memory fallback + handleClientError
        });
      },

      setSessionChatParams: (sessionId: string, params: ChatParams) => {
        set({
          sessionChatParams: {
            ...get().sessionChatParams,
            [sessionId]: params,
          },
        });
      },

      getEffectiveChatParams: (sessionId?: string): ChatParams => {
        if (sessionId) {
          const sessionParams = get().sessionChatParams[sessionId];
          if (sessionParams) return sessionParams;
        }
        return get().chatParams;
      },

      /** 命名空间级设置写入。对 "config" namespace 逐 key 写入 config.json；
       *  其他 namespace（soul/user/voice/system）路由到 /v1/settings/{namespace}。 */
      setSettings: async (
        namespace: string,
        values: Record<string, unknown>,
      ) => {
        set({ isLoading: true, error: null });
        try {
          if (namespace === "config") {
            for (const [key, value] of Object.entries(values)) {
              await configService.set(key, value);
            }
          } else {
            const { httpLegacy } = await import("../services/httpClient");
            await httpLegacy.put(`/v1/settings/${namespace}`, values);
          }
          set({ config: { ...get().config, ...values }, isLoading: false });
        } catch (error) {
          handleClientError(error, {
            module: "stores:config",
            action: "setSettings",
          });
          set({ error: String(error), isLoading: false });
        }
      },

      /** 命名空间级设置读取 */
      getSettings: async <T>(namespace: string): Promise<T> => {
        if (namespace === "config") {
          const cfg = get().config;
          if (Object.keys(cfg).length > 0) return cfg as T;
          await get().loadConfig();
          return get().config as T;
        }
        const { httpLegacy } = await import("../services/httpClient");
        const res = await httpLegacy.get<T>(`/v1/settings/${namespace}`);
        return res;
      },
    }),
    {
      name: "liri-config",
      version: 2,
      // Phase 3.1: 仅保留前端专用字段在 localStorage 中
      // config 子树从后端 API (ConfigManager) 加载，不在 localStorage 冗余存储
      partialize: (state) => ({
        chatParams: state.chatParams,
        sessionChatParams: state.sessionChatParams,
      }),
      migrate: (persistedState: unknown, version: number) => {
        if (version < 2) {
          // v1→v2: 移除 config 子树，避免与 ConfigManager 不一致
          const old = persistedState as Record<string, unknown>;
          return {
            chatParams: old.chatParams,
            sessionChatParams: old.sessionChatParams,
          };
        }
        return persistedState as Record<string, unknown>;
      },
    },
  ),
);

// 状态变更日志（仅开发环境）
import { withStoreLogging } from "../utils/storeLogger";
withStoreLogging(useConfigStore, "configStore", []);
