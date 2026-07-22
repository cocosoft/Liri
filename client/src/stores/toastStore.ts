/**
 * Toast 状态存储 — 独立 Zustand Store
 *
 * 用于管理全局 Toast 通知的显示与自动消除。
 * 通过独立的 Store 实现精细订阅，避免无关变更触发重渲染。
 */
import { create } from "zustand";

/** Toast 类型 */
export type ToastType = "success" | "error" | "info" | "warning";

/** Toast 通知条目 */
export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

/** Toast Store 接口 */
interface ToastStore {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

/**
 * Toast 状态管理 Store
 *
 * 支持 auto-dismiss：默认 3 秒后自动移除 Toast。
 * addToast 通过 crypto.randomUUID() 生成唯一 ID。
 */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (type: ToastType, message: string, duration: number = 3000) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, duration }],
    }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
