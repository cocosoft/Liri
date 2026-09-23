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
 * TrajectoryRow 组件测试 —— P3-4（2026-09-22）：`metric/timing` 行内耗时 / tokens。
 *
 * 语义锁定：**只展示事件自带的字段**（回合级有 duration、请求级有 tokens），
 * 缺项就不显示 —— 不得补 0 或跨事件拼接。
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrajectoryRow } from "../components/Trajectory/TrajectoryRow";
import type { LiriEvent } from "../types";

function ev(
  seq: number,
  time: number,
  type: LiriEvent["type"],
  data: Record<string, unknown>,
): LiriEvent {
  return { seq, time, type, data } as unknown as LiriEvent;
}

describe("TrajectoryRow（P3-4：metric/timing 行内预览）", () => {
  it("回合级 ⇒ `stage · 耗时`", () => {
    render(
      <TrajectoryRow
        event={ev(2, 9000, "metric/timing", {
          stage: "assistant",
          duration: 1500,
        })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("assistant · 1.5 s")).toBeTruthy();
  });

  it("请求级 ⇒ `stage · tokens`", () => {
    render(
      <TrajectoryRow
        event={ev(3, 9000, "metric/timing", {
          stage: "request",
          tokens: 12_000,
        })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(/^request · 12/)).toBeTruthy();
  });

  it("缺 duration / tokens ⇒ 只显示 stage，不补假值", () => {
    render(
      <TrajectoryRow
        event={ev(4, 9000, "metric/timing", { stage: "assistant" })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("assistant")).toBeTruthy();
  });

  it("非 metric/timing 事件仍走原预览（content）", () => {
    render(
      <TrajectoryRow
        event={ev(1, 1000, "assistant/text", { content: "hello world" })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  // TC-1（2026-09-23）：补齐 getEventPreview 的其余候选字段分支（此前未覆盖）
  it.each([
    [{ name: "FileReadTool" }, "name=FileReadTool"],
    [{ error: "boom" }, "boom"],
    [{ message: "外部事件" }, "外部事件"],
    [{ result: "ok" }, "ok"],
    [{ turn: 3 }, "turn=3"],
    [{ summary: "摘要正文" }, "摘要正文"],
  ])("预览候选字段 %o ⇒ %s", (data, expected) => {
    render(
      <TrajectoryRow
        event={ev(5, 9000, "system/info", data as Record<string, unknown>)}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("超长 error / result / summary ⇒ 截断为 80 字符 + 省略号", () => {
    const long = "x".repeat(120);
    for (const [key, type] of [
      ["error", "system/error"],
      ["result", "tool/result"],
      ["summary", "context/summary"],
    ] as const) {
      const { unmount } = render(
        <TrajectoryRow
          event={ev(6, 9000, type, { [key]: long })}
          selected={false}
          onClick={() => {}}
        />,
      );
      expect(screen.getByText("x".repeat(80) + "…")).toBeTruthy();
      unmount();
    }
  });

  it("无任何候选字段 ⇒ 不渲染预览行", () => {
    const { container } = render(
      <TrajectoryRow
        event={ev(7, 9000, "system/info", { unrelated: 1 })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector(".truncate")).toBeNull();
  });
});
