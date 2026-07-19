/**
 * 办公模块主题 hook（v6）
 * 解析 theme 设置，auto 模式通过 matchMedia 监听系统主题变化
 */

import { useEffect, useState } from "react";
import { useOfficeStore } from "../stores/officeStore";

/**
 * 返回当前实际生效的主题（'light' | 'dark'）
 * auto 模式下监听系统 prefers-color-scheme 变化
 */
export function useTheme(): "light" | "dark" {
  const theme = useOfficeStore((s) => s.theme);
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (theme !== "auto") {
      setResolved(theme);
      return;
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setResolved(mq.matches ? "dark" : "light");

    const handler = (e: MediaQueryListEvent) =>
      setResolved(e.matches ? "dark" : "light");

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return resolved;
}
