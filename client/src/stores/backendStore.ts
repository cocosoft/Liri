import { create } from "zustand";
import { chatService } from "../services/chatService";
import type { BackendStatus } from "../types";

async function isTauriApp(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) {
    return true;
  }
  try {
    await import("@tauri-apps/api/core");
    return true;
  } catch {
    return false;
  }
}

interface BackendStore {
  status: BackendStatus;
  isChecking: boolean;
  error: string | null;
  isBrowserMode: boolean;

  checkStatus: () => Promise<void>;
  startBackend: () => Promise<void>;
  stopBackend: () => Promise<void>;
  clearError: () => void;
  initBrowserMode: () => Promise<void>;
}

export const useBackendStore = create<BackendStore>((set) => ({
  status: { running: false, port: null },
  isChecking: false,
  error: null,
  isBrowserMode: true,

  initBrowserMode: async () => {
    const tauri = await isTauriApp();
    set({ isBrowserMode: !tauri });
  },

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

    const isTauri = !useBackendStore.getState().isBrowserMode;
    if (!isTauri) {
      set({
        error:
          "浏览器模式下无法自动启动后端。请在终端中运行：\n" +
          "cd app && bun run src/main.ts repl --http-port 7890\n" +
          "启动后刷新页面。",
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

    const isTauri = !useBackendStore.getState().isBrowserMode;
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
