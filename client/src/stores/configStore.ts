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
  loadConfig: () => Promise<void>;
  setConfig: (key: string, value: unknown) => Promise<void>;
  setChatParams: (params: ChatParams) => Promise<void>;
  /** 保存会话级别的 chatParams */
  setSessionChatParams: (sessionId: string, params: ChatParams) => void;
  /** 读取会话级别的 chatParams（优先 session，fallback global） */
  getEffectiveChatParams: (sessionId?: string) => ChatParams;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      config: {},
      chatParams: { ...DEFAULT_CHAT_PARAMS },
      sessionChatParams: {},
      isLoading: false,
      error: null,

      loadConfig: async () => {
        set({ isLoading: true, error: null });
        try {
          const config = await configService.list();
          // 加载持久化的 chatParams（后端优先，本地 persist 兜底）
          const persistedParams = config["chat.params"] as ChatParams | undefined;
          set({
            config,
            chatParams: persistedParams ?? get().chatParams,
            isLoading: false,
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
          sessionChatParams: { ...get().sessionChatParams, [sessionId]: params },
        });
      },

      getEffectiveChatParams: (sessionId?: string): ChatParams => {
        if (sessionId) {
          const sessionParams = get().sessionChatParams[sessionId];
          if (sessionParams) return sessionParams;
        }
        return get().chatParams;
      },
    }),
    {
      name: "liri-config",
      partialize: (state) => ({
        config: state.config,
        chatParams: state.chatParams,
        sessionChatParams: state.sessionChatParams,
      }),
    },
  ),
);

// 状态变更日志（仅开发环境）
import { withStoreLogging } from "../utils/storeLogger";
withStoreLogging(useConfigStore, "configStore", []);
