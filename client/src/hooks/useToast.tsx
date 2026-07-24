/**
 * useToast — 统一通知系统 (Phase 1 W4)
 *
 * 替代各组件各自管理的 useState + setTimeout 通知，
 * 内置去重：相同类型的相同消息在 1 秒内不重复弹出。
 */
import { useState, useCallback, useRef, useEffect } from "react";

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
}

export function useToast(duration = 3000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 清理所有定时器 (unmount 时)
  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const show = useCallback(
    (type: Toast["type"], message: string) => {
      setToasts((prev) => {
        // 去重：如果最后一条类型和消息相同，不重复添加
        const last = prev[prev.length - 1];
        if (last && last.type === type && last.message === message) {
          return prev;
        }
        const id = String(++counter.current);
        const timer = setTimeout(() => {
          setToasts((current) => current.filter((t) => t.id !== id));
          timers.current.delete(id);
        }, duration);
        timers.current.set(id, timer);
        return [...prev.slice(-2), { id, type, message }];
      });
    },
    [duration],
  );

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, show, dismiss };
}

/**
 * Toast 容器组件 — 渲染在页面顶层
 */
export function ToastContainer({
  toasts,
  dismiss,
  isDark,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
  isDark?: boolean;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const colorClasses = {
          success: isDark
            ? "bg-green-900/80 border-green-700 text-green-200"
            : "bg-green-100 border-green-200 text-green-800",
          error: isDark
            ? "bg-red-900/80 border-red-700 text-red-200"
            : "bg-red-100 border-red-200 text-red-800",
          warning: isDark
            ? "bg-yellow-900/80 border-yellow-700 text-yellow-200"
            : "bg-yellow-100 border-yellow-200 text-yellow-800",
          info: isDark
            ? "bg-blue-900/80 border-blue-700 text-blue-200"
            : "bg-blue-100 border-blue-200 text-blue-800",
        }[toast.type];

        return (
          <div
            key={toast.id}
            className={`px-4 py-2 rounded-lg border shadow-lg text-sm flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 ${colorClasses}`}
          >
            <span>{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              className="opacity-50 hover:opacity-100 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
