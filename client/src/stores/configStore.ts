import { create } from "zustand";
import { persist } from "zustand/middleware";
import { configService } from "../services/configService";
import { handleClientError } from "@/utils/handleError";

interface ConfigStore {
  config: Record<string, unknown>;
  isLoading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  setConfig: (key: string, value: unknown) => Promise<void>;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      config: {},
      isLoading: false,
      error: null,

      loadConfig: async () => {
        set({ isLoading: true, error: null });
        try {
          const config = await configService.list();
          set({ config, isLoading: false });
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
    }),
    {
      name: "liri-config",
      partialize: (state) => ({ config: state.config }),
    },
  ),
);

// 状态变更日志（仅开发环境）
import { withStoreLogging } from "../utils/storeLogger";
withStoreLogging(useConfigStore, "configStore", []);
