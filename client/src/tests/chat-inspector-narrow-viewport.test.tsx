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
 * S28（2026-10-08）：窄视口下 ChatInspector「展开即被回设收起」的守卫。
 *
 * 原实现：小屏自动收起的 effect 依赖 `[isOpen, setOpen]` 且体内直接调 `handleResize()`
 * ⇒ 每次 `isOpen` 变为 true 都会**立刻**按当前宽度重判并回设 `false` ⇒ CollapsedBar 点击 /
 * `Ctrl+1~4` / ``Ctrl+` `` 在小屏（<1024）全部失效 ⇒「模式」等 Tab **永不可达**。
 *
 * 本守卫锁三条：
 *  1. 窄视口点击收起态 Tab ⇒ 面板**能**展开（修复前该断言为 `false`）；
 *  2. 窄视口下**窗口 resize** 仍按设计自动收起（保留"小屏默认收起"语义）；
 *  3. 宽视口不受影响（resize 不收起）。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import ChatInspector from "../components/ChatInspector/ChatInspector";
import { useChatInspectorStore } from "../stores/chatInspectorStore";

// 仅为隔离：Tab 内容与本缺陷无关（避免挂载各 Tab 的重量级依赖）
vi.mock("../components/ChatInspector/ContextTab", () => ({
  default: () => null,
}));
vi.mock("../components/ChatInspector/PatternsTab", () => ({
  default: () => null,
}));

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setInnerWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: px,
  });
}

beforeEach(() => {
  useChatInspectorStore.setState({ isOpen: false, activeTab: "context" });
});

afterEach(() => {
  setInnerWidth(ORIGINAL_INNER_WIDTH);
});

describe("ChatInspector：窄视口可达性（S28）", () => {
  it("窄视口(<1024) 点击收起态 Tab ⇒ 面板可展开（修复前会被 effect 立刻回设 false）", () => {
    setInnerWidth(800);
    const { getByTitle } = render(<ChatInspector />);

    // 收起态：CollapsedBar 的「模式」按钮（title 形如 "展开到模式 Tab"）
    const patternsBtn = getByTitle("展开到模式 Tab");
    act(() => {
      fireEvent.click(patternsBtn);
    });

    expect(useChatInspectorStore.getState().activeTab).toBe("patterns");
    expect(useChatInspectorStore.getState().isOpen).toBe(true);
    // 面板确已展开（出现"收起面板"按钮）
    expect(getByTitle("收起面板")).toBeTruthy();
  });

  it('窄视口下窗口 resize ⇒ 仍按设计自动收起（保留"小屏默认收起"）', () => {
    setInnerWidth(800);
    render(<ChatInspector />);

    act(() => {
      useChatInspectorStore.getState().setOpen(true);
    });
    expect(useChatInspectorStore.getState().isOpen).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(useChatInspectorStore.getState().isOpen).toBe(false);
  });

  it("宽视口(≥1024) 展开后 resize 不收起", () => {
    setInnerWidth(1400);
    render(<ChatInspector />);

    act(() => {
      useChatInspectorStore.getState().setOpen(true);
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(useChatInspectorStore.getState().isOpen).toBe(true);
  });
});
