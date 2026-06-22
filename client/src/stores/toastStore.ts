/**
 * Toast 状态存储 — 已合并到 appStore
 *
 * 本文件为向后兼容的薄封装层，所有状态实际存储在 appStore 中。
 * 通过独立的 useSelector 调用实现精细订阅，避免无关变更触发重渲染。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { Toast, ToastType } from "./appStore";
export type { ToastType, Toast } from "./appStore";

/** Toast 相关状态切片类型 */
interface ToastSlice {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

/** 从 appStore 中提取 toast 相关状态 */
function toastSlice(state: {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}): ToastSlice {
  return {
    toasts: state.toasts,
    addToast: state.addToast,
    removeToast: state.removeToast,
  };
}

/**
 * 使用 toast 状态（兼容原 useToastStore API）
 *
 * 无参调用返回完整 toast 切片：
 *   const { addToast } = useToastStore();
 *
 * 传选择器可精细订阅：
 *   const addToast = useToastStore((s) => s.addToast);
 */
export function useToastStore(): ToastSlice;
export function useToastStore<T>(selector: (slice: ToastSlice) => T): T;
export function useToastStore(selector?: any): any {
  // 三个独立订阅，仅当对应字段变化时触发重渲染
  const toasts = useAppStore((s) => s.toasts);
  const addToast = useAppStore((s) => s.addToast);
  const removeToast = useAppStore((s) => s.removeToast);

  const slice = { toasts, addToast, removeToast };
  return selector ? selector(slice) : slice;
}

/** 兼容原有 store.getState() 调用（测试中使用） */
useToastStore.getState = () => toastSlice(useAppStore.getState());
/** 兼容原有 store.setState() 调用（测试中使用） */
useToastStore.setState = (partial: Partial<ToastSlice>) => {
  useAppStore.setState(partial as any);
};
