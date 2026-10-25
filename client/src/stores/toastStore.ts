/**
 * toastStore — 轻量 Toast 通知（**全站唯一 toast 通道**）
 *
 * 用于显示网络错误等临时提示，自动消失。
 * 不同于 ErrorTracker（系统级），toast 面向用户瞬时反馈。
 *
 * ## 错误呈现口径（2026-10-16 台账 `TOAST-SINGLE-CHANNEL`）
 *
 * 三条通道各司其职，**不要互相替代**：
 * 1. **toast（本文件）** —— 瞬时、与页面位置无关的反馈：异步/后台失败、网络错误、批量操作结果。
 *    异常类优先用 {@link toastError}（自动 `friendlyErrorSummary` + 可展开的原始异常 `detail`）；
 *    需要**带业务上下文**的文案时用 `push(文案, "error", detail)`；
 *    只有半旧调用点还在用 `addToast(type, message)`（等价于 `push(message, type)`）。
 * 2. **就地内联**（各组件自己的 `error` 区 / 红字） —— 与**当前表单/字段/操作**强绑定的失败
 *    （保存失败、字段校验）：位置本身在传达"错在哪" ⇒ **有意保留**，不要改成 toast。
 * 3. **`handleClientError`（`utils/handleError.ts`）** —— **只做**标准化 + 日志 + OTEL + 内存统计 +
 *    后端上报，**不做任何用户可见呈现**；需要上屏时必须另外配 toast 或内联。
 *
 * 容器：`components/common/ToastContainer`（由 `App.tsx` 全局挂载；**唯一**容器）。
 * ⚠️ 历史上曾有第二套实现 `hooks/useToast`（自管 useState + 自带容器，右上角、无 detail），
 * 唯一使用者在 `KnowledgePage` —— 已收敛并删除；新增守卫见 `tests/toastSingleChannel.test.ts`。
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

/** 便捷方法：显示成功 toast（如"导出已完成"这类瞬时正向反馈） */
export function toastSuccess(message: string): void {
  useToastStore.getState().push(message, "success");
}
