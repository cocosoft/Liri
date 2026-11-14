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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FloatingContext } from "../lib/floatingContext";

const closeFloatingWindow = vi.fn(async () => {});
const focusMainWindow = vi.fn(async () => {});
// G8 窗口体验（2026-11-14）：面板挂载即初始化几何（测试里空实现，避免触达 Tauri）
const initFloatingWindowGeometry = vi.fn(async () => {});
// G8 点击穿透（2026-11-14）：默认成功；个别用例改成失败
const setFloatingPassthrough = vi.fn(async (_enabled: boolean) => true);

// G8 内容增强（2026-11-14）：上下文加载走 mock，避免真实 HTTP
let mockContext: FloatingContext = {
  session: { id: "sess-1", title: "会话 A" },
  goals: [],
  unavailable: false,
};
const loadFloatingContext = vi.fn(async () => mockContext);

vi.mock("../lib/floatingWindow", () => ({
  closeFloatingWindow: () => closeFloatingWindow(),
  focusMainWindow: () => focusMainWindow(),
  initFloatingWindowGeometry: () => initFloatingWindowGeometry(),
  setFloatingPassthrough: (enabled: boolean) => setFloatingPassthrough(enabled),
}));

vi.mock("../lib/floatingContext", () => ({
  loadFloatingContext: () => loadFloatingContext(),
}));

import { FloatingPanel } from "../components/Floating/FloatingPanel";
import { useOperationProgressStore } from "../stores/operationProgressStore";

describe("FloatingPanel", () => {
  beforeEach(() => {
    closeFloatingWindow.mockClear();
    focusMainWindow.mockClear();
    loadFloatingContext.mockClear();
    setFloatingPassthrough.mockClear();
    setFloatingPassthrough.mockResolvedValue(true);
    mockContext = {
      session: { id: "sess-1", title: "会话 A" },
      goals: [],
      unavailable: false,
    };
    // 跳过 SSE 注册（测试环境不联网）
    useOperationProgressStore.setState({ operations: [], _inited: true });
  });

  it("无操作 ⇒ 空状态提示 + 标题", async () => {
    render(<FloatingPanel />);
    expect(screen.getByText("Liri · 后台状态")).toBeInTheDocument();
    expect(screen.getByText("暂无进行中的操作。")).toBeInTheDocument();
    // 等上下文加载完成，避免异步 setState 落到断言之后（act 警告）
    expect(await screen.findByText("会话 A")).toBeInTheDocument();
  });

  it("有操作 ⇒ 复用状态条展示标签（空状态消失）", async () => {
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
    expect(await screen.findByText("会话 A")).toBeInTheDocument();
  });

  it("关闭按钮走 closeFloatingWindow；回到主窗口走 focusMainWindow", async () => {
    render(<FloatingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "关闭悬浮窗" }));
    expect(closeFloatingWindow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "回到主窗口" }));
    expect(focusMainWindow).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("会话 A")).toBeInTheDocument();
  });

  it("内容增强：展示当前会话与运行中目标（含预算）", async () => {
    mockContext = {
      session: { id: "sess-1", title: "会话 A" },
      goals: [
        {
          id: "g1",
          objective: "重构计划模块",
          tokensUsed: 1200,
          tokenBudget: 5000,
        },
        { id: "g2", objective: "补测试", tokensUsed: 30, tokenBudget: null },
      ],
      unavailable: false,
    };
    render(<FloatingPanel />);

    expect(await screen.findByText("会话 A")).toBeInTheDocument();
    expect(screen.getByText("重构计划模块")).toBeInTheDocument();
    expect(screen.getByText("1200/5000 tokens")).toBeInTheDocument();
    expect(screen.getByText("30 tokens")).toBeInTheDocument();
  });

  it("内容增强：无当前会话 / 无目标 ⇒ 如实给空态（不臆造）", async () => {
    mockContext = { session: null, goals: [], unavailable: false };
    render(<FloatingPanel />);

    expect(await screen.findByText("未选择会话")).toBeInTheDocument();
    expect(screen.getByText("暂无运行中目标")).toBeInTheDocument();
  });

  it("内容增强：读取失败 ⇒ 标注不可用（不显示为'没有目标'）", async () => {
    mockContext = { session: null, goals: [], unavailable: true };
    render(<FloatingPanel />);

    expect(
      await screen.findByText("暂时读不到上下文（后端不可达）"),
    ).toBeInTheDocument();
    expect(screen.queryByText("暂无运行中目标")).toBeNull();
  });

  it("内容增强：手动刷新重新加载上下文", async () => {
    render(<FloatingPanel />);
    await waitFor(() => expect(loadFloatingContext).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(loadFloatingContext).toHaveBeenCalledTimes(2));
  });

  it("点击穿透：成功后显示退出提示并禁用按钮（不持久化）", async () => {
    render(<FloatingPanel />);
    const button = screen.getByRole("button", { name: "穿透" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(setFloatingPassthrough).toHaveBeenCalledWith(true),
    );
    expect(
      await screen.findByText("点击穿透中 · 按 Ctrl+Shift+F 退出"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "穿透" })).toBeDisabled();
  });

  it("点击穿透：环境不支持 ⇒ 如实提示失败（不显示穿透中）", async () => {
    setFloatingPassthrough.mockResolvedValue(false);
    render(<FloatingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "穿透" }));

    expect(
      await screen.findByText("当前环境不支持点击穿透"),
    ).toBeInTheDocument();
    expect(screen.queryByText("点击穿透中 · 按 Ctrl+Shift+F 退出")).toBeNull();
    expect(screen.getByRole("button", { name: "穿透" })).not.toBeDisabled();
  });
});
