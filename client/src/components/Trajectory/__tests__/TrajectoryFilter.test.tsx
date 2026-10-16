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
 * TrajectoryFilter 的**类型候选接线**回归测试（2026-10-16，台账 `TRAJECTORY-TYPE-FILTER-DYNAMIC`）。
 *
 * 钉住"最吵的两类现在**真的**有按钮"这一回归（原静态 21 项清单里没有
 * `metric/timing` / `request/start`），以及两条可用性不变量：
 *   ① 按钮来自 `availableTypes`（次数降序），点击 ⇒ `onChange({ types })` 切换
 *   ② **已选但当前会话未出现**的类型仍保留按钮（否则切会话后"筛出 0 条且取消不了"）
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrajectoryFilter } from "../TrajectoryFilter";
import type { TrajectoryFilterState } from "@/stores/chat/trajectoryStore";
import type { LiriEventType } from "@/types";

// i18n：键原样返回（真实文案不在本测试的断言目标内）
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeFilter(
  over: Partial<TrajectoryFilterState> = {},
): TrajectoryFilterState {
  return {
    categories: [],
    types: [],
    keyword: "",
    sources: [],
    ...over,
  };
}

const AVAILABLE = [
  { type: "metric/timing" as LiriEventType, count: 65 },
  { type: "request/start" as LiriEventType, count: 33 },
  { type: "assistant/text" as LiriEventType, count: 9 },
];

describe("TrajectoryFilter — 类型候选动态渲染", () => {
  it("回归：最吵的两类（metric/timing / request/start）在按钮里", () => {
    render(
      <TrajectoryFilter
        filter={makeFilter({ keyword: "x" })} // 有关键字 ⇒ 面板初值展开
        onChange={vi.fn()}
        availableTypes={AVAILABLE}
      />,
    );
    // 有 i18n 键者显示译文（此处 mock 为键名），无键者回落原始 type 串
    expect(screen.getByText("trajectory.type.metricTiming")).toBeTruthy();
    expect(screen.getByText("request/start")).toBeTruthy();
    expect(screen.getByText("trajectory.type.reply")).toBeTruthy();
  });

  it("点击类型按钮 ⇒ onChange 收到该类型的选中态", () => {
    const onChange = vi.fn();
    render(
      <TrajectoryFilter
        filter={makeFilter({ keyword: "x" })}
        onChange={onChange}
        availableTypes={AVAILABLE}
      />,
    );
    fireEvent.click(screen.getByText("request/start"));
    expect(onChange).toHaveBeenCalledWith({ types: ["request/start"] });
  });

  it("已选但当前会话未出现的类型仍保留按钮（否则取消不掉）", () => {
    const onChange = vi.fn();
    render(
      <TrajectoryFilter
        filter={makeFilter({ types: ["assistant/diff"], keyword: "x" })}
        onChange={onChange}
        availableTypes={AVAILABLE}
      />,
    );
    const chip = screen.getByText("assistant/diff");
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith({ types: [] });
  });

  it("缺省 availableTypes ⇒ 不渲染类型按钮（仅分类/来源/关键字/区间可用）", () => {
    render(
      <TrajectoryFilter
        filter={makeFilter({ keyword: "x" })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("trajectory.type.reply")).toBeNull();
    expect(screen.queryByText("metric/timing")).toBeNull();
  });
});
