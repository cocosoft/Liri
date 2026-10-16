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
 * `DailyLimitNotice` 两态契约（2026-10-17，台账 `BUDGET-SUSPEND-CONTINUE-ENTRY`）。
 *
 * **为什么需要**：同一张卡承载两种语义，而它们对用户是**不同动作**：
 * - **撞限当下**（`suspended=false`）：消息被拦 ⇒ 主按钮「继续」= **显式重发**（D-f，不静默重发）；
 * - **预算挂起**（`suspended=true`）：会话已封存、**进度已保存** ⇒ 主按钮 = **放行（临时提额）**，
 *   后端协调器**自动续跑**，**不需要**重发。
 * 若两态文案/按钮标签漂回同一句，用户又会读到"提前终止"式的误导（本机实证的痛点）。
 *
 * 本用例只用**受控 props**（组件不引 i18n 实例 ⇒ `t` 由测试注入并回传 key 本身，便于断言用了**哪个键**）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DailyLimitNotice from "../components/ChatArea/DailyLimitNotice";

/** 文案函数：回传 key（断言"用了哪个键"，而非具体文案 —— 文案属 i18n 资源职责） */
const t = (key: string) => key;

function setup(suspended: boolean) {
  const onRelief = vi.fn();
  const onContinue = vi.fn();
  const onOpenSettings = vi.fn();
  const onDismiss = vi.fn();
  render(
    <DailyLimitNotice
      used={10.03}
      limit={10}
      unit="usd"
      mode="locked"
      suspended={suspended}
      t={t}
      onRelief={onRelief}
      onContinue={onContinue}
      onOpenSettings={onOpenSettings}
      onDismiss={onDismiss}
    />,
  );
  return { onRelief, onContinue, onOpenSettings, onDismiss };
}

describe("DailyLimitNotice 两态契约", () => {
  it("挂起态：用 `card.suspended` 文案 + 主按钮为「继续（临时提额）」，且标记 data-suspended", () => {
    const { onContinue } = setup(true);
    const card = screen.getByTestId("daily-limit-notice");
    expect(card.getAttribute("data-suspended")).toBe("true");
    // 挂起态**不得**再用"撞限当下"的提示语
    expect(screen.queryByText("cost.card.hint")).toBeNull();
    expect(screen.getByText("cost.card.suspended")).toBeTruthy();
    // 主按钮把成本含义写在标签上（放行 = 临时提额）
    // 主按钮文案形如「▶ <key>」（图标与文案分属两个文本节点）⇒ 按**可访问名**匹配
    const mainBtn = screen.getByRole("button", {
      name: /cost\.action\.continueSuspended/,
    });
    expect(mainBtn).toBeTruthy();
    // 主按钮仍是唯一的"继续"，点击回调交宿主（宿主决定 = 放行 + 等自动续跑）
    fireEvent.click(mainBtn);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("撞限当下（默认态）：保持原提示语与原主按钮标签（**零回归**）", () => {
    setup(false);
    const card = screen.getByTestId("daily-limit-notice");
    expect(card.getAttribute("data-suspended")).toBe("false");
    expect(screen.getByText("cost.card.hint")).toBeTruthy();
    expect(screen.queryByText("cost.card.suspended")).toBeNull();
    expect(
      screen.getByRole("button", { name: /cost\.action\.continue$/ }),
    ).toBeTruthy();
  });

  it("三档放行与设置/关闭入口在两态下都可用（同一张卡，不因挂起而丢动作）", () => {
    const { onRelief, onOpenSettings, onDismiss } = setup(true);
    for (const [key, kind] of [
      ["cost.action.boost", "boost"],
      ["cost.action.waiveOnce", "waive-once"],
      ["cost.action.unlockToday", "unlock-today"],
    ] as const) {
      fireEvent.click(screen.getByText(key));
      expect(onRelief).toHaveBeenCalledWith(kind);
    }
    fireEvent.click(screen.getByText("cost.action.openSettings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle("common.close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
