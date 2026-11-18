// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G8 内容增强（2026-11-14）：悬浮窗上下文的 React 绑定。
 *
 * 刷新时机：**挂载时 + 窗口重新获得焦点时 + 手动**（不做后台轮询，避免副窗口常驻定时器）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadFloatingContext,
  type FloatingContext,
} from "../../lib/floatingContext";

export interface UseFloatingContextResult {
  context: FloatingContext | null;
  loading: boolean;
  refresh: () => void;
}

export function useFloatingContext(): UseFloatingContextResult {
  const [context, setContext] = useState<FloatingContext | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void loadFloatingContext()
      .then((next) => setContext(next))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 回到悬浮窗（从主窗口切回）时同步最新会话/目标
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { context, loading, refresh };
}
