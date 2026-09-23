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
 * TrajectoryPlayer 组件测试（P2-4 / TC-1，2026-09-23）
 *
 * 此前该文件**零覆盖**（实测 0%）。本组用例锁定的语义：
 * - 无行（`totalRows === 0`）⇒ 播放与前后 turn 按钮**禁用**；
 * - 播放按钮的 `aria-label` 随 `playing` 在「播放 / 暂停」间切换（不只看图标）；
 * - 倍速按钮回传**数值**（1/2/4），进度条回传**数字**（不是字符串）；
 * - 进度文案为 `index/total · pct%`，且 `totalRows === 0` 时**不除零**（pct 归 0）。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrajectoryPlayer } from "../components/Trajectory/TrajectoryPlayer";

type PlayerProps = Parameters<typeof TrajectoryPlayer>[0];

function setup(over: Partial<PlayerProps> = {}) {
  const props: PlayerProps = {
    totalRows: 10,
    playing: false,
    playbackSpeed: 1,
    playbackIndex: 3,
    onToggle: vi.fn(),
    onSpeed: vi.fn(),
    onSeek: vi.fn(),
    onPrevTurn: vi.fn(),
    onNextTurn: vi.fn(),
    ...over,
  };
  render(<TrajectoryPlayer {...props} />);
  return props;
}

describe("TrajectoryPlayer（TC-1）", () => {
  it("totalRows=0 ⇒ 播放 / 前后 turn 按钮全部禁用", () => {
    setup({ totalRows: 0, playbackIndex: 0 });
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一个 turn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一个 turn" })).toBeDisabled();
  });

  it("播放按钮：aria-label 随 playing 切换，点击回传 onToggle", () => {
    const props = setup({ playing: false });
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it("playing=true ⇒ 同一按钮变为「暂停」语义", () => {
    const props = setup({ playing: true });
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it("倍速按钮回传数值：1x / 2x / 4x", () => {
    const props = setup({ playbackSpeed: 1 });
    fireEvent.click(screen.getByText("2x"));
    expect(props.onSpeed).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByText("4x"));
    expect(props.onSpeed).toHaveBeenCalledWith(4);
  });

  it("前后 turn 按钮分别回传 onPrevTurn / onNextTurn", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "上一个 turn" }));
    fireEvent.click(screen.getByRole("button", { name: "下一个 turn" }));
    expect(props.onPrevTurn).toHaveBeenCalledTimes(1);
    expect(props.onNextTurn).toHaveBeenCalledTimes(1);
  });

  it("进度条回传**数字**索引，且文案为 index/total · pct%", () => {
    const props = setup({ totalRows: 10, playbackIndex: 3 });
    const slider = screen.getByRole("slider", { name: "回放进度" });
    fireEvent.change(slider, { target: { value: "7" } });
    expect(props.onSeek).toHaveBeenCalledWith(7);
    expect(screen.getByText("3/10 · 30%")).toBeDefined();
  });

  it("totalRows=0 ⇒ 进度文案不除零（0/0 · 0%）", () => {
    setup({ totalRows: 0, playbackIndex: 0 });
    expect(screen.getByText("0/0 · 0%")).toBeDefined();
  });
});
