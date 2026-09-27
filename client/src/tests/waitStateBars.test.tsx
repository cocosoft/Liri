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
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusFloatBar from "../components/ChatArea/StatusFloatBar";
import YieldNoticeBar from "../components/ChatArea/YieldNoticeBar";

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
          triggerAt: Date.now() + 90_000,
          seconds: 12,
        }}
      />,
    );
    expect(screen.getByText(/等待中，预计 \d+ 秒后自动继续/)).toBeTruthy();
  });

  it("selfwake 无 triggerAt ⇒ 只说已等待秒数（不猜剩余时间）", () => {
    render(
      <StatusFloatBar
        wait={{
          waiting: true,
          reason: "selfwake",
          unresolved: false,
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
          seconds: 1,
        }}
      />,
    );
    expect(container.querySelector(".animate-ping")).toBeNull();
    expect(container.querySelector(".bg-sky-500")).toBeTruthy();
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
