import { create } from 'zustand';
import { chatService } from '../services/chatService';
import type { BackendStatus } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

interface BackendStore {
  status: BackendStatus;
  isChecking: boolean;
  error: string | null;
  isBrowserMode: boolean;

  checkStatus: () => Promise<void>;
  startBackend: () => Promise<void>;
  stopBackend: () => Promise<void>;
  clearError: () => void;
}

export const useBackendStore = create<BackendStore>((set) => ({
  status: { running: false, port: null },
  isChecking: false,
  error: null,
  isBrowserMode: !isTauri,

  checkStatus: async () => {
    set({ isChecking: true });
    try {
      const status = await chatService.getBackendStatus();
      set({ status, isChecking: false, error: null });
    } catch (e) {
      set({
        status: { running: false, port: null },
        isChecking: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  startBackend: async () => {
    set({ error: null });

    if (!isTauri) {
      set({
        error:
          '浏览器模式下无法自动启动后端。请在终端中运行：\n' +
          'cd backend && bun start -- --http-port 7890\n' +
          '启动后刷新页面。',
      });
      return;
    }

    try {
      const status = await chatService.startBackend();
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  stopBackend: async () => {
    set({ error: null });

    if (!isTauri) {
      set({ status: { running: false, port: null } });
      return;
    }

    try {
      await chatService.stopBackend();
      set({ status: { running: false, port: null } });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  clearError: () => set({ error: null }),
}));
