import { create } from 'zustand';
import { configService } from '../services/configService';

interface ConfigStore {
  config: Record<string, unknown>;
  isLoading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
  setConfig: (key: string, value: unknown) => Promise<void>;
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  config: {},
  isLoading: false,
  error: null,

  loadConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await configService.list();
      set({ config, isLoading: false });
    } catch (error) {
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
      set({ error: String(error), isLoading: false });
    }
  },
}));