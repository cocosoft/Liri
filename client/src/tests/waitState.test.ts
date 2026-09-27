// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `deriveWaitState` 单测（等待态可见性，2026-09-27）
 *
 * Spec：`.trae/specs/wait-state-visibility.md` §3.2(b)。
 * 纯函数，不依赖 React；覆盖两类等待（yield / selfwake）与"非等待"分支，
 * 并锁死"不伪造剩余时间"（无 `triggerAt` ⇒ 不带该字段）。
 */
import { describe, it, expect } from "vitest";
import { deriveWaitState } from "../components/ChatArea/useWaitState";

describe("deriveWaitState（等待态推导）", () => {
  it("流式中 ⇒ 非等待态（此时反馈由 SSE 承担）", () => {
    expect(
      deriveWaitState({ streaming: true, yieldState: "waiting" }, true),
    ).toEqual({ waiting: false, unresolved: false });
  });

  it("yieldState='waiting' ⇒ yield 等待（无 triggerAt）", () => {
    expect(
      deriveWaitState({ streaming: false, yieldState: "waiting" }, false),
    ).toEqual({ waiting: true, reason: "yield", unresolved: false });
  });

  it("pendingWake（timer）⇒ selfwake 等待 + 透出真实 triggerAt", () => {
    const triggerAt = Date.now() + 60_000;
    expect(
      deriveWaitState(
        {
          streaming: false,
          pendingWake: { kind: "timer", triggerAt, createdAt: 1 },
        },
        false,
      ),
    ).toEqual({
      waiting: true,
      reason: "selfwake",
      unresolved: false,
      triggerAt,
    });
  });

  it("pendingWake（completion，无 triggerAt）⇒ selfwake 等待，且**不伪造** triggerAt", () => {
    const d = deriveWaitState(
      { streaming: false, pendingWake: { kind: "completion", createdAt: 1 } },
      false,
    );
    expect(d).toEqual({ waiting: true, reason: "selfwake", unresolved: false });
    expect("triggerAt" in d).toBe(false);
  });

  it("yieldState='unresolved' ⇒ 需用户介入，但不算'等待中'", () => {
    expect(
      deriveWaitState({ streaming: false, yieldState: "unresolved" }, false),
    ).toEqual({ waiting: false, unresolved: true });
  });

  it("无任何信号（含 undefined 状态）⇒ 非等待态", () => {
    expect(deriveWaitState({ streaming: false }, false)).toEqual({
      waiting: false,
      unresolved: false,
    });
    expect(deriveWaitState(undefined, false)).toEqual({
      waiting: false,
      unresolved: false,
    });
  });

  it("unresolved 优先于 pendingWake（避免把'已失败'说成'正在等'）", () => {
    expect(
      deriveWaitState(
        {
          streaming: false,
          yieldState: "unresolved",
          pendingWake: { kind: "timer", triggerAt: Date.now(), createdAt: 1 },
        },
        false,
      ),
    ).toEqual({ waiting: false, unresolved: true });
  });
});
