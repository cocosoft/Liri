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
 * 会话侧栏折叠状态策略测试（2026-10-16，台账 `SIDEBAR-NARROW-AUTOCOLLAPSE-LEAK`）。
 *
 * 回归目标（真机缺陷）：进入窄屏的 effect 原为「折叠 + `localStorage.setItem(..., 'false')`」，
 * 且**无回宽屏恢复分支** ⇒ 窗口只要曾 ≤1023px，之后在 1090px 也永久停在 48px 折叠栏；
 * 而折叠态不渲染任何会话行 ⇒ 侧栏选不了会话。
 *
 * 本文件钉住三条不变量：
 *   ① 窄屏自动折叠**不写持久化**（偏好只由用户操作写）
 *   ② 回到宽屏 ⇒ **恢复用户偏好**（偏好 true 则展开；偏好 false 保持折叠）
 *   ③ 用户手动切换**优先**，之后回宽屏不再被"自动恢复"覆盖
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SIDEBAR_EXPANDED_KEY,
  SIDEBAR_NARROW_QUERY,
  applyManualToggle,
  applyNarrow,
  readSidebarPreference,
  useSidebarCollapse,
} from "../useSidebarCollapse";

/** 可控的 matchMedia 替身：能读 `matches` 并主动派发 change */
function makeMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    media: SIDEBAR_NARROW_QUERY,
    matches: initialMatches,
    addEventListener: (_type: "change", cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (
      _type: "change",
      cb: (e: MediaQueryListEvent) => void,
    ) => listeners.delete(cb),
  };
  return {
    matchMedia: () => mql as unknown as MediaQueryList,
    set(narrow: boolean) {
      mql.matches = narrow;
      listeners.forEach((cb) => cb({ matches: narrow } as MediaQueryListEvent));
    },
  };
}

/** 内存 localStorage 替身（可读回原始值，用于断言"未被写脏"） */
function makeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(SIDEBAR_EXPANDED_KEY, initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: () => map.get(SIDEBAR_EXPANDED_KEY) ?? null,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("读偏好：无记录 ⇒ 展开（沿用既有默认）", () => {
  it("空存储 ⇒ true；'false' ⇒ false；'true' ⇒ true", () => {
    expect(readSidebarPreference(makeStorage())).toBe(true);
    expect(readSidebarPreference(makeStorage("false"))).toBe(false);
    expect(readSidebarPreference(makeStorage("true"))).toBe(true);
  });
});

describe("纯策略：窄屏只改内存、回宽屏恢复偏好、手动优先", () => {
  const expanded = { expanded: true, prefBeforeAuto: null };

  it("进入窄屏 ⇒ 折叠并记住偏好（纯函数不触碰存储）", () => {
    expect(applyNarrow(expanded, true, true)).toEqual({
      expanded: false,
      prefBeforeAuto: true,
    });
    // 已在窄屏（prefBeforeAuto 非空）再触发 ⇒ 保持，不覆盖已记住的偏好
    expect(
      applyNarrow({ expanded: false, prefBeforeAuto: true }, true, false),
    ).toEqual({ expanded: false, prefBeforeAuto: true });
  });

  it("回到宽屏 ⇒ 恢复偏好（而非无条件展开）", () => {
    expect(
      applyNarrow({ expanded: false, prefBeforeAuto: true }, false, true),
    ).toEqual({ expanded: true, prefBeforeAuto: null });
    // 偏好本就是折叠 ⇒ 回宽屏仍折叠
    expect(
      applyNarrow({ expanded: false, prefBeforeAuto: false }, false, false),
    ).toEqual({ expanded: false, prefBeforeAuto: null });
  });

  it("非自动折叠态（prefBeforeAuto=null）⇒ 宽屏事件不动状态", () => {
    const manual = { expanded: false, prefBeforeAuto: null };
    expect(applyNarrow(manual, false, true)).toBe(manual);
  });

  it("窄屏幂等：状态未变时返回**同一引用**（防无限重渲染）", () => {
    const folded = { expanded: false, prefBeforeAuto: true };
    expect(applyNarrow(folded, true, true)).toBe(folded);
    // 记忆的偏好来源改变也不改写：prefBeforeAuto 已非空 ⇒ 保持原引用
    expect(applyNarrow(folded, true, false)).toBe(folded);
  });

  it("手动切换优先：清掉自动折叠标记并给出待持久化偏好", () => {
    expect(
      applyManualToggle({ expanded: false, prefBeforeAuto: true }),
    ).toEqual({
      next: { expanded: true, prefBeforeAuto: null },
      persisted: true,
    });
    expect(applyManualToggle({ expanded: true, prefBeforeAuto: null })).toEqual(
      {
        next: { expanded: false, prefBeforeAuto: null },
        persisted: false,
      },
    );
  });
});

describe("useSidebarCollapse：真实时序（窄屏 → 宽屏）", () => {
  it("回归：窄屏自动折叠**不写 localStorage**；回宽屏恢复为偏好（true ⇒ 展开）", () => {
    const storage = makeStorage("true"); // 用户偏好 = 展开
    const mm = makeMatchMedia(false); // 初始宽屏

    const { result } = renderHook(() =>
      useSidebarCollapse({ storage, matchMedia: mm.matchMedia }),
    );
    expect(result.current.isExpanded).toBe(true);

    // 进入窄屏 ⇒ 折叠，但**不得**把偏好写成 false（旧实现正是这里写脏了）
    act(() => mm.set(true));
    expect(result.current.isExpanded).toBe(false);
    expect(storage.raw()).toBe("true");

    // 回到宽屏（1090px 这类"本不该折叠"的窗口）⇒ 恢复偏好 ⇒ 展开
    act(() => mm.set(false));
    expect(result.current.isExpanded).toBe(true);
    expect(storage.raw()).toBe("true");
  });

  it("偏好为折叠的用户：窄屏折叠、回宽屏仍折叠（不擅自展开）", () => {
    const storage = makeStorage("false");
    const mm = makeMatchMedia(false);
    const { result } = renderHook(() =>
      useSidebarCollapse({ storage, matchMedia: mm.matchMedia }),
    );
    expect(result.current.isExpanded).toBe(false);

    act(() => mm.set(true));
    expect(result.current.isExpanded).toBe(false);
    act(() => mm.set(false));
    expect(result.current.isExpanded).toBe(false);
    expect(storage.raw()).toBe("false");
  });

  it("用户手动切换优先：窄屏里手动展开 ⇒ 回宽屏不被覆盖，且偏好已持久化", () => {
    const storage = makeStorage("true");
    const mm = makeMatchMedia(true); // 直接从窄屏起（自动折叠生效）
    const { result } = renderHook(() =>
      useSidebarCollapse({ storage, matchMedia: mm.matchMedia }),
    );
    expect(result.current.isExpanded).toBe(false);

    act(() => result.current.toggleSidebar());
    expect(result.current.isExpanded).toBe(true);
    expect(storage.raw()).toBe("true");

    // 回宽屏：应保持手动结果（展开），不被"自动恢复"改写
    act(() => mm.set(false));
    expect(result.current.isExpanded).toBe(true);
  });

  it("初始为窄屏且偏好未设置 ⇒ 折叠；回宽屏 ⇒ 按默认偏好展开", () => {
    const storage = makeStorage();
    const mm = makeMatchMedia(true);
    const { result } = renderHook(() =>
      useSidebarCollapse({ storage, matchMedia: mm.matchMedia }),
    );
    expect(result.current.isExpanded).toBe(false);
    act(() => mm.set(false));
    expect(result.current.isExpanded).toBe(true);
    // 全程未写过偏好
    expect(storage.raw()).toBeNull();
  });
});

describe("生产形态（不注入依赖）：不得陷入无限重渲染", () => {
  it("未传 storage/matchMedia 时渲染次数有界（回归 `Maximum update depth exceeded`）", () => {
    // 2026-10-21 浏览器实测：默认 matchMedia 每次渲染现建箭头函数 ⇒ effect 依赖恒变
    // ⇒ effect 内 setState 触发下一次渲染 ⇒ 无限循环。
    window.localStorage.clear();
    const mql = {
      media: SIDEBAR_NARROW_QUERY,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    vi.stubGlobal("matchMedia", () => mql);

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useSidebarCollapse();
    });

    expect(result.current.isExpanded).toBe(true);
    expect(renders).toBeLessThanOrEqual(3);

    vi.unstubAllGlobals();
    window.localStorage.clear();
  });
});
