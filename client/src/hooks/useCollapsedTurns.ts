// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * useCollapsedTurns —— Turn 级折叠状态的**单一实现**（P1-6 归一化，2026-09-22）
 *
 * 背景：折叠此前只在「日志 Tab」（`LogTab.tsx`）存在，轨迹 Tab 没有；而折叠的**状态机制**
 * （`Set<turn>` + 切换 + 组内成员判定）在两个 Tab 之间完全同构 ⇒ 抽为本 hook，避免两套实现漂移。
 *
 * 边界（刻意不合并的部分）：两个 Tab 的 **turn 头渲染**保持各自实现 ——
 * 日志 Tab 显示分类计数徽标（💭/💬/🛠/⚠️/❌），轨迹 Tab 显示 seq 区间与事件数，
 * 二者信息不同属**有意的产品差异**，不做"统一成一个头"的改动。
 */

import { useCallback, useState } from "react";

export interface CollapsedTurns {
  /** 已折叠的 turn 序号集合（只读视图） */
  collapsedTurns: ReadonlySet<number>;
  /** 切换某个 turn 的折叠态 */
  toggleTurn: (turn: number) => void;
  /** 判定某个 turn 是否已折叠 */
  isCollapsed: (turn: number) => boolean;
  /** 清空全部折叠态（会话切换时调用，避免沿用上一会话的 turn 序号） */
  clear: () => void;
}

export function useCollapsedTurns(): CollapsedTurns {
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );

  const toggleTurn = useCallback((turn: number) => {
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  }, []);

  const isCollapsed = useCallback(
    (turn: number) => collapsedTurns.has(turn),
    [collapsedTurns],
  );

  const clear = useCallback(() => setCollapsedTurns(new Set<number>()), []);

  return { collapsedTurns, toggleTurn, isCollapsed, clear };
}
