// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G8 一期：悬浮面板渲染与动作接线。
 *
 * 语义：
 * - 无后台操作 ⇒ 显示空状态提示（不显示空进度条）；
 * - 有操作 ⇒ 复用 `OperationStatusBar` 展示标签（单一来源，不另写一份进度渲染）；
 * - 关闭 / 回到主窗口分别调用窗口控制的**单一实现**（`lib/floatingWindow`）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const closeFloatingWindow = vi.fn(async () => {});
const focusMainWindow = vi.fn(async () => {});
// G8 窗口体验（2026-11-14）：面板挂载即初始化几何（测试里空实现，避免触达 Tauri）
const initFloatingWindowGeometry = vi.fn(async () => {});

vi.mock("../lib/floatingWindow", () => ({
  closeFloatingWindow: () => closeFloatingWindow(),
  focusMainWindow: () => focusMainWindow(),
  initFloatingWindowGeometry: () => initFloatingWindowGeometry(),
}));

import { FloatingPanel } from "../components/Floating/FloatingPanel";
import { useOperationProgressStore } from "../stores/operationProgressStore";

describe("FloatingPanel", () => {
  beforeEach(() => {
    closeFloatingWindow.mockClear();
    focusMainWindow.mockClear();
    // 跳过 SSE 注册（测试环境不联网）
    useOperationProgressStore.setState({ operations: [], _inited: true });
  });

  it("无操作 ⇒ 空状态提示 + 标题", () => {
    render(<FloatingPanel />);
    expect(screen.getByText("Liri · 后台状态")).toBeInTheDocument();
    expect(screen.getByText("暂无进行中的操作。")).toBeInTheDocument();
  });

  it("有操作 ⇒ 复用状态条展示标签（空状态消失）", () => {
    useOperationProgressStore.setState({
      operations: [
        {
          id: "op-1",
          label: "知识库编译",
          progress: 0.5,
          updatedAt: Date.now(),
        },
      ],
    });
    render(<FloatingPanel />);
    expect(screen.getByText("知识库编译")).toBeInTheDocument();
    expect(screen.queryByText("暂无进行中的操作。")).toBeNull();
  });

  it("关闭按钮走 closeFloatingWindow；回到主窗口走 focusMainWindow", () => {
    render(<FloatingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "关闭悬浮窗" }));
    expect(closeFloatingWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "回到主窗口" }));
    expect(focusMainWindow).toHaveBeenCalledTimes(1);
  });
});
