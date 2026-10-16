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
 * 「系统导航」必须转发 `MenuItem.onClickOverride` —— BUG-1 回归锁（2026-10-16 P3 真机复验）
 *
 * **真机现场**：桌面视口点左侧栏「设置」⇒ **整页跳到 `/settings`**，右侧设置抽屉从不出现
 * ⇒ P3 新增的「工具可见性」tab（`settingsPanelStore` 的 `tools`）在真机上**不可达**
 * （移动底栏的 `openSettings` 是唯一其它触发点，而它在 `lg:hidden` 下拿不到）。
 *
 * **根因**：`SYSTEM_ITEMS` 的渲染块**漏转发** `onClickOverride` —— 该字段正是为"打开抽屉"
 * 而设（`SYSTEM_ITEMS` 的 `settings` 项写着 `onClickOverride: () => …openPanel()`），
 * 而高频导航的渲染块一直有转发。
 *
 * **为什么用源码扫描**：`Sidebar` 依赖 6+ 个 store / 路由 / 主题上下文，渲染成本与脆弱度都高；
 * 本仓已有同类手法（`event-contract-parity.test.ts` 读 client 源码断言必需导入）。
 * 本用例**只锚定「系统导航」区块内部**（跨度 = 该注释到下一条同级注释），
 * 因此不会误命中其它区块的同名 prop。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SIDEBAR = resolve(__dirname, "../../Sidebar/Sidebar.tsx");

/** 区块锚点（分开拼写：避免该片段在**块注释**里出现，从而提前闭合注释） */
const SYSTEM_NAV_ANCHOR = "{/* 系统导航 *" + "/}";

describe("Sidebar 系统导航：onClickOverride 必须转发（BUG-1 回归锁）", () => {
  const src = readFileSync(SIDEBAR, "utf-8");

  /** 取出「系统导航」区块源码（从该系统导航注释锚点起，到下一条同级 JSX 注释为止） */
  function systemNavBlock(): string {
    const start = src.indexOf(SYSTEM_NAV_ANCHOR);
    if (start < 0) throw new Error("未找到系统导航注释锚点");
    const rest = src.slice(start);
    const nextAnchor = rest.indexOf("{/*", 10); // 跳过锚点自身
    return nextAnchor > 0 ? rest.slice(0, nextAnchor) : rest;
  }

  it("SYSTEM_ITEMS 的渲染块转发 onClickOverride={item.onClickOverride}", () => {
    expect(systemNavBlock()).toContain(
      "onClickOverride={item.onClickOverride}",
    );
  });

  it("反向自证：`settings` 项确实声明了打开抽屉的 onClickOverride（否则转发也无意义）", () => {
    expect(src).toContain(
      "onClickOverride: () => useSettingsPanelStore.getState().openPanel()",
    );
  });
});
