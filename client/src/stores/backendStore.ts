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
import i18n from "../i18n";
import type { BackendStatus } from "../types";

const logger = createLogger("stores:backendStore");

/**
 * F-08（2026-10-29）：浏览器模式下底栏「运行中/已停止」的判停阈值。
 * `chatService.getBackendStatus()` 在浏览器里等价于**单次** `/health` 探测，
 * 一次抖动就会翻状态；改为连续 N 次探测失败才判停（与
 * `services/connectionMonitor.ts` 的 `FAIL_THRESHOLD = 3` 同口径）。
 */
const BACKEND_FAIL_THRESHOLD = 3;
/** 连续探测失败计数（成功即清零；显式启停动作也清零） */
let backendFailStreak = 0;

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
      // F-08（2026-10-29）：浏览器模式下 `getBackendStatus()` = 单次 `/health` 探测，
      // 一次抖动/超时就会把底栏从「运行中」翻成「已停止」，下一次 5s 轮询又翻回来
      // ⇒ 真机可见的状态跳变。改为连续 3 次失败才判停（与 connectionMonitor 的
      // FAIL_THRESHOLD=3 同口径，CS01 复用既有阈值语义）；Tauri 模式仍以进程状态为准。
      if (status.running) {
        backendFailStreak = 0;
        set({ status, isChecking: false, error: null });
        return;
      }
      if (!get().isBrowserMode || !get().status.running) {
        set({ status, isChecking: false, error: null });
        return;
      }
      backendFailStreak++;
      if (backendFailStreak >= BACKEND_FAIL_THRESHOLD) {
        set({ status, isChecking: false, error: null });
      } else {
        logger.warn("[checkStatus] 后端探测失败一次，保留上一次状态", {
          streak: backendFailStreak,
        });
        set({ isChecking: false });
      }
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
            ? i18n.t("backend.startFailed", { error: status.error })
            : i18n.t("backend.exitedWithCode", { code: status.exit_code });
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
        error: i18n.t("backend.browserModeStart", {
          port: DEFAULT_BACKEND_PORT,
        }),
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
