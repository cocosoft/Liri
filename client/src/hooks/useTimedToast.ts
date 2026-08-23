/**
 * P2-10 修复：定时 Toast Hook — 统一 setTimeout cleanup
 *
 * 问题：ChatMessage 有 6 处 setTimeout（copyToast/captureToast/showUndo/undoWarning）无 cleanup，
 *       组件卸载时 toast 状态更新会报错
 * 方案：抽 useTimedToast(duration)，ref 存 timer + 卸载 clear
 */

import { useRef, useEffect, useCallback, useState } from "react";

export function useTimedToast<T>(initialValue: T | null, duration: number) {
  const [value, setValue] = useState<T | null>(initialValue);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const show = useCallback(
    (v: T) => {
      // 清理旧 timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setValue(v);
      // 自动隐藏
      timerRef.current = setTimeout(() => {
        setValue(null);
      }, duration);
    },
    [duration],
  );

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setValue(null);
  }, []);

  return [value, show, hide] as const;
}
