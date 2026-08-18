/**
 * Backend 状态存储 — 独立 Zustand Store
 *
 * 管理后端进程的启动、停止、状态检查。
 * 支持 Tauri 原生模式与浏览器模式两种运行环境检测。
 */
import { create } from "zustand";
import { chatService } from "../services/chatService";
import { handleClientError } from "@/utils/handleError";
import { createLogger } from "../utils/logger";
import { DEFAULT_BACKEND_PORT } from "../services/backendUrl";
import type { BackendStatus } from "../types";

const logger = createLogger("stores:backendStore");

export type { BackendStatus };

/** Backend Store 状态切片 */
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

/**
 * Backend 状态管理 Store
 *
 * 浏览器模式下无法自动启动后端，需提示用户在终端中手动启动。
 * Tauri 模式下可通过 chatService 控制后端进程的启停。
 */
export const useBackendStore = create<BackendStore>((set, get) => ({
  status: { running: false, port: null },
  isChecking: false,
  error: null,
  isBrowserMode: true,

  initBrowserMode: async () => {
    const tauri = await (async () => {
      if (typeof window === "undefined") return false;
      if ("__TAURI__" in window || "__TAURI_INTERNALS__" in window) return true;
      try {
        await import("@tauri-apps/api/core");
        return true;
      } catch {
        return false;
      }
    })();
    set({ isBrowserMode: !tauri });
  },

  checkStatus: async () => {
    set({ isChecking: true });
    try {
      const status = await chatService.getBackendStatus();
      logger.info("[checkStatus] 后端状态", status);
      set({ status, isChecking: false, error: null });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:backendStore", action: "checkStatus" },
        "warn",
      );
      logger.error("[checkStatus] 状态检查失败", {
        error: e instanceof Error ? e.message : String(e),
      });
      set({
        status: { running: false, port: null },
        isChecking: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  startBackend: async () => {
    set({ error: null });
    if (!get().isBrowserMode) {
      try {
        logger.info("[startBackend] Tauri 模式，调用 chatService.startBackend");
        const status = await chatService.startBackend();
        logger.info("[startBackend] 完成，最终状态", status);
        set({ status });
        // 后端启动失败时，将退出码/stderr 展示给用户（而非仅"连接被拒"）
        if (!status.running && (status.exit_code != null || status.error)) {
          const errorMsg = status.error
            ? `后端进程启动失败：\n${status.error}`
            : `后端进程异常退出，退出码：${status.exit_code}`;
          logger.error("[startBackend] 后端启动失败", { errorMsg });
          set({ error: errorMsg });
        }
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:backendStore", action: "startBackend" },
          "warn",
        );
        logger.error("[startBackend] 启动异常", {
          error: e instanceof Error ? e.message : String(e),
        });
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    } else {
      logger.warn("[startBackend] 浏览器模式，无法自动启动后端");
      set({
        error:
          `浏览器模式下无法自动启动后端。请在终端中运行：\ncd app && bun run src/main.ts repl --http-port ${DEFAULT_BACKEND_PORT}\n启动后刷新页面。`,
      });
    }
  },

  stopBackend: async () => {
    set({ error: null });
    if (!get().isBrowserMode) {
      try {
        logger.info("[stopBackend] 调用 chatService.stopBackend");
        await chatService.stopBackend();
        logger.info("[stopBackend] 后端已停止");
        set({ status: { running: false, port: null } });
      } catch (e) {
        handleClientError(
          e,
          { module: "stores:backendStore", action: "stopBackend" },
          "warn",
        );
        logger.error("[stopBackend] 停止异常", {
          error: e instanceof Error ? e.message : String(e),
        });
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    } else {
      set({ status: { running: false, port: null } });
    }
  },

  clearError: () => set({ error: null }),
}));
