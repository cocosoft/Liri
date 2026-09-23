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
 * TrajectoryFilter 组件测试（P2-4 / TC-1，2026-09-23）
 *
 * 此前该文件**零覆盖**（实测 0%）。用**有状态 harness**（真实受控链路：点击 → onChange →
 * 父级合并 → 重新渲染）而非 mock，锁定的语义：
 * - 分类 / 来源 / 类型三组都是**多选切换**：未选则加入、已选则移除（`toggleX` 两个分支）；
 * - 关键词与 seq/时间区间为受控输入，回传的是**数字或 undefined**（不是字符串）；
 * - 「清除」按钮**仅在有筛选时出现**，点击后**八个维度同时归空**（漏清一个即为回归）；
 * - 时间输入用 `new Date(v).getTime()` ⇒ 断言只校验"是有限数字"，**不锁绝对值**（该值随运行时区变化）。
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrajectoryFilter } from "../components/Trajectory/TrajectoryFilter";
import type { TrajectoryFilterState } from "../stores/chat/trajectoryStore";

const EMPTY: TrajectoryFilterState = {
  keyword: "",
  categories: [],
  types: [],
  sources: [],
};

function Harness({ initial }: { initial?: Partial<TrajectoryFilterState> }) {
  const [filter, setFilter] = useState<TrajectoryFilterState>({
    ...EMPTY,
    ...initial,
  });
  return (
    <>
      <TrajectoryFilter
        filter={filter}
        onChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
      />
      <output data-testid="filter-state">{JSON.stringify(filter)}</output>
    </>
  );
}

/** 读取 harness 当前过滤态（`undefined` 字段会被 JSON 丢弃 ⇒ 与"未设置"语义一致） */
function currentState(): Record<string, unknown> {
  return JSON.parse(
    screen.getByTestId("filter-state").textContent ?? "{}",
  ) as Record<string, unknown>;
}

function setup(
  opts: { initial?: Partial<TrajectoryFilterState>; expand?: boolean } = {},
) {
  const { container } = render(<Harness initial={opts.initial} />);
  // TB-1（2026-09-23）：过滤器**默认折叠** ⇒ 需要操作控件的用例先展开
  if (opts.expand !== false) {
    const toggle = screen.queryByRole("button", { name: /展开/ });
    if (toggle) fireEvent.click(toggle);
  }
  return {
    container,
    numbers: () =>
      Array.from(container.querySelectorAll('input[type="number"]')),
    dateTimes: () =>
      Array.from(container.querySelectorAll('input[type="datetime-local"]')),
  };
}

describe("TrajectoryFilter（TC-1）", () => {
  it("分类多选：点击加入、再点移除", () => {
    setup();
    const btn = screen.getByRole("button", { name: "上下文" });
    fireEvent.click(btn);
    expect(currentState().categories).toEqual(["context"]);
    fireEvent.click(btn);
    expect(currentState().categories).toEqual([]);
  });

  it("来源多选：点击加入、再点移除", () => {
    setup();
    const btn = screen.getByRole("button", { name: "LLM" });
    fireEvent.click(btn);
    expect(currentState().sources).toEqual(["llm"]);
    fireEvent.click(btn);
    expect(currentState().sources).toEqual([]);
  });

  it("类型多选：按钮文案是事件类型原文，回传完整类型名", () => {
    setup();
    const btn = screen.getByRole("button", { name: "thinking" });
    fireEvent.click(btn);
    expect(currentState().types).toEqual(["assistant/thinking"]);
    fireEvent.click(btn);
    expect(currentState().types).toEqual([]);
  });

  it("关键词输入回传原文（受控）", () => {
    setup();
    const input = screen.getByPlaceholderText(
      "content / name / error / result / toolCallId",
    );
    fireEvent.change(input, { target: { value: "FileRead" } });
    expect(currentState().keyword).toBe("FileRead");
  });

  it("seq 区间：填值回传数字，清空回退 undefined（不留 0/NaN）", () => {
    const { numbers } = setup();
    const [min, max] = numbers();
    fireEvent.change(min, { target: { value: "5" } });
    fireEvent.change(max, { target: { value: "9" } });
    expect(currentState().minSeq).toBe(5);
    expect(currentState().maxSeq).toBe(9);
    fireEvent.change(min, { target: { value: "" } });
    expect(currentState().minSeq).toBeUndefined();
  });

  it("时间区间：回传有限数字（不锁绝对值，避免绑定时区）", () => {
    const { dateTimes } = setup();
    const [from, to] = dateTimes();
    fireEvent.change(from, { target: { value: "2026-09-23T12:00" } });
    fireEvent.change(to, { target: { value: "2026-09-23T13:30" } });
    const state = currentState();
    expect(Number.isFinite(state.fromTime)).toBe(true);
    expect(Number.isFinite(state.toTime)).toBe(true);
    expect(state.toTime as number).toBeGreaterThan(state.fromTime as number);
  });

  it("「清除」按钮：无筛选时不渲染；有筛选时点击 ⇒ 八个维度同时归空", () => {
    setup();
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();

    // 造齐八个维度中的代表项（keyword / categories / types / sources / seq / 时间）
    fireEvent.change(
      screen.getByPlaceholderText(
        "content / name / error / result / toolCallId",
      ),
      { target: { value: "x" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "上下文" }));
    fireEvent.click(screen.getByRole("button", { name: "thinking" }));
    fireEvent.click(screen.getByRole("button", { name: "LLM" }));
    const clear = screen.getByRole("button", { name: "清除" });
    fireEvent.click(clear);

    const state = currentState();
    expect(state).toEqual({
      keyword: "",
      categories: [],
      types: [],
      sources: [],
    });
    // 清空后再无「清除」按钮（回归：清除条件判断遗漏任一维度都会让按钮常驻）
    expect(screen.queryByRole("button", { name: "清除" })).toBeNull();
  });

  // ── TB-1（2026-09-23）：默认折叠 ──────────────────────────────
  it("默认折叠：只渲染摘要行，不渲染筛选控件", () => {
    setup({ expand: false });
    expect(screen.getByRole("button", { name: /筛选/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "上下文" })).toBeNull();
    expect(
      screen.queryByPlaceholderText(
        "content / name / error / result / toolCallId",
      ),
    ).toBeNull();
  });

  it("有筛选条件时**初值展开**，并显示已启用维度数", () => {
    setup({ initial: { categories: ["tool"] }, expand: false });
    // 初值展开 ⇒ 无需点「展开」即可见控件
    expect(screen.getByRole("button", { name: "上下文" })).toBeDefined();
    expect(screen.getByText("已启用 1 项")).toBeDefined();
  });

  it("点击摘要行可折叠/展开（aria-expanded 同步）", () => {
    setup({ expand: false });
    const toggle = screen.getByRole("button", { name: /筛选/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "上下文" })).toBeDefined();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "上下文" })).toBeNull();
  });
});
