/**
 * `useOnceOnMount` —— **StrictMode 双调用去重**的"首挂载执行一次"钩子（2026-10-30，M15/M9）。
 *
 * 背景：`main.tsx` 开启 `React.StrictMode` 后，dev 下 effect 会「挂载 → 卸载 → 再挂载」执行两次，
 * 首屏请求因此重复（真机实测 `/tasks` 的 `GET /v1/cron`、`GET /v1/cron/status` 各 2 次；
 * 渠道页 `GET /v1/channels`、`/v1/channels/schema` 各 2 次）。
 *
 * 既有做法是各页各写一个 `useRef(false)` 守卫（`MediaPage` / `TerminalPage` / `ProjectsPage`）；
 * 本钩子是同一模式的**唯一实现**（CS01），新页面直接用，不再复制守卫代码。
 *
 * 语义边界：**只在组件首次挂载执行一次**；依赖变化**不会**重跑（需要随依赖重跑的场景不要用本钩子）。
 */
import { useEffect, useRef } from "react";

export function useOnceOnMount(effect: () => void): void {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    effect();
    // 只在首挂载执行：依赖变化不重跑是**本钩子的契约**，故显式忽略 exhaustive-deps。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
