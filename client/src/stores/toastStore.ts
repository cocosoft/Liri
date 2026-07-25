/**
 * toastStore — 轻量 Toast 通知
 *
 * 用于显示网络错误等临时提示，自动消失。
 * 不同于 ErrorTracker（系统级），toast 面向用户瞬时反馈。
 */
import { create } from "zustand";
import {
  friendlyErrorSummary,
  getRawErrorMessage,
} from "../utils/friendlyError";

export interface Toast {
  id: string;
  message: string;
  detail?: string; // 可折叠的原始异常信息
  type: "error" | "warning" | "info" | "success";
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  /** 添加 toast */
  push: (message: string, type?: Toast["type"], detail?: string) => void;
  /** 添加 toast（旧签名兼容：type 优先） */
  addToast: (type: Toast["type"], message: string, detail?: string) => void;
  /** 移除指定 toast */
  dismiss: (id: string) => void;
}

let counter = 0;
const MAX_TOASTS = 3;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (message, type = "error", detail) => {
    const id = `toast_${Date.now()}_${++counter}`;
    const toast: Toast = { id, message, detail, type, createdAt: Date.now() };
    set((s) => {
      const next = [...s.toasts, toast];
      if (next.length > MAX_TOASTS) {
        return { toasts: next.slice(-MAX_TOASTS) };
      }
      return { toasts: next };
    });
    const duration = type === "error" ? 8000 : 4000;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  /** 旧签名兼容：addToast(type, message) → push(message, type) */
  addToast: (type, message, detail) => {
    useToastStore.getState().push(message, type, detail);
  },

  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** 便捷方法：显示错误 toast（自动翻译） */
export function toastError(error: unknown): void {
  useToastStore
    .getState()
    .push(friendlyErrorSummary(error), "error", getRawErrorMessage(error));
}

/** 便捷方法：显示警告 toast */
export function toastWarning(message: string): void {
  useToastStore.getState().push(message, "warning");
}

/** 便捷方法：显示信息 toast */
export function toastInfo(message: string): void {
  useToastStore.getState().push(message, "info");
}
