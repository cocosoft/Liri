// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 等待态**组件**测试（等待态可见性，2026-09-27）
 *
 * Spec：`.trae/specs/wait-state-visibility.md` §3.2(c) / D5 / D6 / D7。
 * 锁死三件事：
 * 1. 等待期浮动栏**保持渲染**（原实现：流一停即卸载 ⇒ 界面像"答完了"）；
 * 2. `waiting` 文案**迁入浮动栏**，`YieldNoticeBar` 只承担 `unresolved`（需用户介入）；
 * 3. 等待期指示点为**静态**（不脉冲 ⇒ 不谎报"正在输出"）。
 *
 * 文案断言走测试基座的真实 zh 字典（`createTestT`，缺键即抛错）⇒ 字典漏拷会在此暴露。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StatusFloatBar from "../components/ChatArea/StatusFloatBar";
import YieldNoticeBar from "../components/ChatArea/YieldNoticeBar";
import { useChatStore } from "../stores/chat";

describe("StatusFloatBar —— 等待态（2026-09-27）", () => {
  it("空闲且无等待 ⇒ 进入渐隐（opacity-0，2s 后卸载）—— 既有行为不变", () => {
    const { container } = render(<StatusFloatBar />);
    // 注意：挂载后 effect 会置 fadingOut=true ⇒ 先以 opacity-0 渲染 2s 才卸载（N-49 既定语义）
    expect(container.querySelector(".opacity-0")).toBeTruthy();
  });

  it("**等待期不渐隐**（opacity-100，真正可见）—— 本次修复要点", () => {
    const { container } = render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "selfwake",
          unresolved: false,
          remoteStreaming: false,
          seconds: 3,
        }}
      />,
    );
    expect(container.querySelector(".opacity-0")).toBeNull();
    expect(container.querySelector(".opacity-100")).toBeTruthy();
  });

  it("selfwake 带 triggerAt ⇒ 常驻渲染并显示**倒计时**（真实测量值）", () => {
    render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "selfwake",
          unresolved: false,
          remoteStreaming: false,
          triggerAt: Date.now() + 90_000,
          seconds: 12,
        }}
      />,
    );
    expect(screen.getByText(/等待中，预计 \d+ 秒后自动继续/)).toBeTruthy();
  });

  it("selfwake 已过期未触发（overdue）⇒ 如实说明，不再给恒为 0 的倒计时", () => {
    render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "selfwake",
          unresolved: false,
          remoteStreaming: false,
          triggerAt: Date.now() - 120_000,
          overdue: true,
          seconds: 130,
        }}
      />,
    );
    expect(
      screen.getByText(/等待已过期（后端尚未触发），已 130 秒/),
    ).toBeTruthy();
  });

  it("selfwake 无 triggerAt ⇒ 只说已等待秒数（不猜剩余时间）", () => {
    render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "selfwake",
          unresolved: false,
          remoteStreaming: false,
          seconds: 42,
        }}
      />,
    );
    expect(screen.getByText(/等待中（已 42 秒）/)).toBeTruthy();
  });

  it("yield 等待 ⇒ 显示'等待子任务结算中' + 已等待秒数", () => {
    render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "yield",
          unresolved: false,
          remoteStreaming: false,
          seconds: 7,
        }}
      />,
    );
    expect(screen.getByText(/等待子任务结算中（已 7 秒）/)).toBeTruthy();
  });

  it("等待期指示点为**静态蓝点**（无 animate-ping ⇒ 不谎报'正在输出'）", () => {
    const { container } = render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "selfwake",
          unresolved: false,
          remoteStreaming: false,
          seconds: 1,
        }}
      />,
    );
    expect(container.querySelector(".animate-ping")).toBeNull();
    expect(container.querySelector(".bg-sky-500")).toBeTruthy();
  });
});

describe("StatusFloatBar —— 只读接入入口（2026-11-18）", () => {
  it("remoteStreaming ⇒ 显示「接入」按钮，点击调用 attachSessionStream(sessionId)", () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ attachSessionStream: attach });

    render(
      <StatusFloatBar
        sessionId="s1"
        wait={{
          waiting: false,
          unresolved: false,
          remoteStreaming: true,
          seconds: 0,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "接入" }));
    expect(attach).toHaveBeenCalledWith("s1");
  });

  it("remoteStreaming=false ⇒ 不显示「接入」按钮（不提供无效动作）", () => {
    render(
      <StatusFloatBar
        sessionId="s1"
        wait={{
          waiting: false,
          unresolved: false,
          remoteStreaming: false,
          seconds: 0,
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "接入" })).toBeNull();
  });
});

describe("YieldNoticeBar —— 职责收敛（2026-09-27）", () => {
  it("unresolved=false ⇒ 不渲染（waiting 已迁至浮动栏，避免两处同信息）", () => {
    const { container } = render(<YieldNoticeBar unresolved={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("unresolved=true ⇒ 渲染明确告警（需用户介入）", () => {
    render(<YieldNoticeBar unresolved />);
    expect(screen.getByText(/未能自动恢复/)).toBeTruthy();
  });
});

/**
 * 2026-11-24：浮动栏与工具组头文案一致
 *
 * 现场：流未结束时若有调用在等审批，组头显示「⏳ 等待审批」，
 * 浮动栏却仍显示「AI 正在生成回复 / 实现中」⇒ 两处矛盾。
 */
describe("StatusFloatBar —— 与工具组头一致（2026-11-24）", () => {
  const resetChat = () =>
    useChatStore.setState({
      isStreaming: false,
      isSending: false,
      messages: [],
    });

  it("执行中 + 待审批 ⇒ 文案取「等待审批」，不谎报正在生成", () => {
    resetChat();
    useChatStore.setState({
      isStreaming: true,
      messages: [
        {
          id: "a1",
          role: "assistant",
          session_id: "s1",
          timestamp: Date.now(),
          content: "",
          blocks: [
            {
              id: "b1",
              type: "inbox",
              content: "",
              inboxData: {
                inboxId: "box-1",
                type: "approval",
                status: "pending",
              },
            },
          ],
        },
      ] as never,
    });

    render(<StatusFloatBar />);
    expect(screen.getByText(/等待审批/)).toBeTruthy();
    expect(screen.queryByText(/正在生成回复/)).toBeNull();
    resetChat();
  });

  it("空闲且无运行/等待态 ⇒ 左侧不显示「正在生成回复」（仅为未收尾入口常驻）", () => {
    resetChat();
    const { container } = render(<StatusFloatBar />);
    // 空闲且无任何常驻理由 ⇒ 渐隐卸载（既有行为）
    expect(container.querySelector(".opacity-0")).toBeTruthy();
    expect(screen.queryByText(/正在生成回复/)).toBeNull();
  });
});
