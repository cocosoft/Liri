/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { BackendStatus } from "../types";

export type { BackendStatus };

/** Backend 状态切片 */
interface BackendSlice {
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

function backendSlice(s: any): BackendSlice {
  return {
    status: s.backendStatus,
    isChecking: s.backendIsChecking,
    error: s.backendError,
    isBrowserMode: s.backendIsBrowserMode,
    checkStatus: s.checkBackendStatus,
    startBackend: s.startBackend,
    stopBackend: s.stopBackend,
    clearError: s.clearBackendError,
    initBrowserMode: s.initBrowserMode,
  };
}

export function useBackendStore(): BackendSlice;
export function useBackendStore<T>(selector: (slice: BackendSlice) => T): T;
export function useBackendStore(selector?: any): any {
  const status = useAppStore((s) => s.backendStatus);
  const isChecking = useAppStore((s) => s.backendIsChecking);
  const error = useAppStore((s) => s.backendError);
  const isBrowserMode = useAppStore((s) => s.backendIsBrowserMode);
  const checkStatus = useAppStore((s) => s.checkBackendStatus);
  const startBackend = useAppStore((s) => s.startBackend);
  const stopBackend = useAppStore((s) => s.stopBackend);
  const clearError = useAppStore((s) => s.clearBackendError);
  const initBrowserMode = useAppStore((s) => s.initBrowserMode);
  const slice: BackendSlice = { status, isChecking, error, isBrowserMode, checkStatus, startBackend, stopBackend, clearError, initBrowserMode };
  return selector ? selector(slice) : slice;
}

useBackendStore.getState = () => backendSlice(useAppStore.getState());
useBackendStore.setState = (partial: Partial<BackendSlice>) => {
  useAppStore.setState({
    ...(partial.status !== undefined && { backendStatus: partial.status }),
    ...(partial.isChecking !== undefined && { backendIsChecking: partial.isChecking }),
    ...(partial.error !== undefined && { backendError: partial.error }),
    ...(partial.isBrowserMode !== undefined && { backendIsBrowserMode: partial.isBrowserMode }),
  } as any);
};
