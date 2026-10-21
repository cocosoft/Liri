// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 会话侧栏（`SessionHistorySidebar`）的**折叠状态策略** —— 2026-10-16 根因修复
 * （台账 `SIDEBAR-NARROW-AUTOCOLLAPSE-LEAK`）。
 *
 * 缺陷（真机 1090×569 实证）：进入窄屏的 effect 原为
 * `setIsExpanded(false); localStorage.setItem('liri-sidebar-expanded', 'false')` —— 与它自己的
 * 注释「不覆盖用户手动设置」相反，且**没有"回到宽屏恢复"的分支** ⇒ 只要窗口曾经 ≤1023px，
 * 之后在 1090px（≥1024，本不该折叠）也会永久停在 `w-12` 折叠栏（48px）；而折叠态下 DOM 里
 * **不渲染任何会话行**（hover 面板只有占位文案）⇒ 侧栏彻底选不了会话。
 *
 * 现口径（三条不变量，均由本模块的纯函数承担，见 `__tests__/useSidebarCollapse.test.ts`）：
 *   ① 窄屏自动折叠**只改内存**，绝不写持久化（偏好只由用户操作写）；
 *   ② 回到宽屏 ⇒ **恢复用户偏好**（而非无条件展开，也非停留在折叠）；
 *   ③ 用户手动切换**优先**：一旦手动操作，本次会话内不再被"自动恢复"覆盖。
 *
 * ⚠️ **键值升到 v2（`-v2` 后缀）**：v1 的值会被旧版"窄屏自动折叠"无条件写成 `false`
 * ⇒ 存量值**无法区分"用户手动折叠"与"被 bug 污染"**。为避免带着脏值继续把侧栏锁在 48px，
 * v2 不复用 v1 的值（缺省回到展开）。旧键不删除（避免破坏式清理）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

/** 持久化键（v2：见文件头注——v1 的值不可信，不复用） */
export const SIDEBAR_EXPANDED_KEY = "liri-sidebar-expanded-v2";

/** 窄屏判据（与既有响应式断点一致：`lg` = 1024px） */
export const SIDEBAR_NARROW_QUERY = "(max-width: 1023px)";

export interface SidebarCollapseState {
  /** 当前是否展开（渲染依据） */
  expanded: boolean;
  /** 进入窄屏前的用户偏好；`null` = 当前不处于"自动折叠"状态 */
  prefBeforeAuto: boolean | null;
}

/** 读用户偏好（无记录 ⇒ 展开，与既有默认一致） */
export function readSidebarPreference(
  storage: Pick<Storage, "getItem">,
  key: string = SIDEBAR_EXPANDED_KEY,
): boolean {
  const saved = storage.getItem(key);
  return saved !== null ? saved === "true" : true;
}

/**
 * 窄屏进入/退出的**纯**状态迁移（不触碰持久化 ⇒ 自动折叠不会污染用户偏好）。
 *
 * @param pref 当前持久化的用户偏好（进入窄屏时记下来，回宽屏时恢复）
 */
export function applyNarrow(
  prev: SidebarCollapseState,
  narrow: boolean,
  pref: boolean,
): SidebarCollapseState {
  if (narrow) {
    // 仅首次进入窄屏时记录偏好；已在窄屏则保持（避免反复覆盖为"折叠后的状态"）
    const prefBeforeAuto = prev.prefBeforeAuto ?? pref;
    // 幂等：状态未变时**返回同一引用** —— 否则每次窄屏事件都生成新对象，
    // 加上 effect 依赖不稳定会演变成无限重渲染（`Maximum update depth exceeded`）
    if (!prev.expanded && prev.prefBeforeAuto === prefBeforeAuto) return prev;
    return { expanded: false, prefBeforeAuto };
  }
  if (prev.prefBeforeAuto === null) return prev; // 非自动折叠态 ⇒ 不动（尊重手动选择）
  return { expanded: prev.prefBeforeAuto, prefBeforeAuto: null };
}

/** 手动切换：用户操作**优先**（清掉自动折叠标记），并给出需要持久化的新偏好 */
export function applyManualToggle(prev: SidebarCollapseState): {
  next: SidebarCollapseState;
  persisted: boolean;
} {
  const expanded = !prev.expanded;
  return { next: { expanded, prefBeforeAuto: null }, persisted: expanded };
}

export interface UseSidebarCollapseOptions {
  /** 注入点（测试用）；缺省 `window.localStorage` */
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** 注入点（测试用）；缺省 `window.matchMedia`（用箭头包一层以保住 `this`） */
  matchMedia?: (query: string) => MediaQueryList;
}

export function useSidebarCollapse(opts: UseSidebarCollapseOptions = {}): {
  isExpanded: boolean;
  toggleSidebar: () => void;
} {
  // 身份稳定：`opts` 是每次渲染新建的对象字面量 ⇒ 默认值若在渲染体里现建箭头函数，
  // `useEffect` 的依赖每次渲染都变，effect 内 `setState` 又会触发下一次渲染
  // ⇒ `Maximum update depth exceeded`（2026-10-21 浏览器实测）。
  // 先解构，依赖只取**注入值**（未注入时恒为 undefined ⇒ 稳定）。
  const { storage: injectedStorage, matchMedia: injectedMatchMedia } = opts;
  const storage = useMemo(
    () => injectedStorage ?? window.localStorage,
    [injectedStorage],
  );
  const matchMedia = useCallback(
    (q: string) =>
      injectedMatchMedia ? injectedMatchMedia(q) : window.matchMedia(q),
    [injectedMatchMedia],
  );

  const [state, setState] = useState<SidebarCollapseState>(() => ({
    expanded: readSidebarPreference(storage),
    prefBeforeAuto: null,
  }));

  useEffect(() => {
    const mq = matchMedia(SIDEBAR_NARROW_QUERY);
    const apply = (narrow: boolean) =>
      setState((prev) =>
        applyNarrow(prev, narrow, readSidebarPreference(storage)),
      );
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [storage, matchMedia]);

  const toggleSidebar = useCallback(() => {
    setState((prev) => {
      const { next, persisted } = applyManualToggle(prev);
      storage.setItem(SIDEBAR_EXPANDED_KEY, String(persisted));
      return next;
    });
  }, [storage]);

  return { isExpanded: state.expanded, toggleSidebar };
}
