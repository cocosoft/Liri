// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `useWaitState` 钩子测试（等待态可见性，2026-09-27）
 *
 * Spec：`.trae/specs/wait-state-visibility.md` §3.2(b)、D3/D4。
 * 锁死**轮询策略**（本项的实质逻辑）：
 * - 等待中 ⇒ 每 `WAIT_POLL_MS` 再拉一次（后端该分支走内存 registry，便宜）；
 * - `unresolved` ⇒ **停止**轮询（后端该分支要读 200 条事件尾，不可高频）；
 * - 非等待态 / 无 sessionId ⇒ 不轮询（流式期间反馈由 SSE 承担）；
 * - `seconds` 按秒递增（本地计时）。
 *
 * 用 `vi.mock` 替换取数模块（vitest 的 mock 按文件隔离，无 bun `mock.module` 的进程级污染问题）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ getSessionRuntimeStatus: vi.fn() }));

vi.mock("../services/sessionService", () => ({
  getSessionRuntimeStatus: mocks.getSessionRuntimeStatus,
}));

import {
  useWaitState,
  WAIT_POLL_MS,
} from "../components/ChatArea/useWaitState";

describe("useWaitState（轮询策略）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getSessionRuntimeStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("无 sessionId ⇒ 不请求、非等待态", async () => {
    const { result } = renderHook(() => useWaitState(undefined, false));
    await act(async () => {});
    expect(mocks.getSessionRuntimeStatus).not.toHaveBeenCalled();
    expect(result.current.waiting).toBe(false);
  });

  it("pendingWake ⇒ 等待态 + 每 WAIT_POLL_MS 轮询一次", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({
      streaming: false,
      pendingWake: {
        kind: "timer",
        triggerAt: 9_999_999_999_999,
        createdAt: 1,
      },
    });

    const { result } = renderHook(() => useWaitState("s1", false));
    await act(async () => {});

    expect(result.current.waiting).toBe(true);
    expect(result.current.reason).toBe("selfwake");
    expect(result.current.triggerAt).toBe(9_999_999_999_999);
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
  });

  it("yieldState='waiting' ⇒ 等待态 + 继续轮询", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({
      streaming: false,
      yieldState: "waiting",
    });

    const { result } = renderHook(() => useWaitState("s2", false));
    await act(async () => {});
    expect(result.current.reason).toBe("yield");

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
  });

  it("unresolved ⇒ 停止轮询（只拉一次）", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({
      streaming: false,
      yieldState: "unresolved",
    });

    const { result } = renderHook(() => useWaitState("s3", false));
    await act(async () => {});
    expect(result.current.unresolved).toBe(true);
    expect(result.current.waiting).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS * 3);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("非等待态 ⇒ 不轮询", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({ streaming: false });

    const { result } = renderHook(() => useWaitState("s4", false));
    await act(async () => {});
    expect(result.current.waiting).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS * 3);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("流式中 ⇒ 即使有 pendingWake 也不进入等待态、不轮询", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({
      streaming: true,
      pendingWake: {
        kind: "timer",
        triggerAt: 9_999_999_999_999,
        createdAt: 1,
      },
    });

    const { result } = renderHook(() => useWaitState("s5", true));
    await act(async () => {});
    expect(result.current.waiting).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS * 3);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("后端仍在跑、本页未接入 ⇒ remoteStreaming=true 且继续轮询", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({ streaming: true });

    const { result } = renderHook(() => useWaitState("s8", false));
    await act(async () => {});
    expect(result.current.remoteStreaming).toBe(true);
    expect(result.current.waiting).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
  });

  it("后台运行结束 ⇒ remoteStreaming 转 false 并停止轮询", async () => {
    mocks.getSessionRuntimeStatus
      .mockResolvedValueOnce({ streaming: true })
      .mockResolvedValue({ streaming: false });

    const { result } = renderHook(() => useWaitState("s9", false));
    await act(async () => {});
    expect(result.current.remoteStreaming).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS);
    });
    expect(result.current.remoteStreaming).toBe(false);

    const calls = mocks.getSessionRuntimeStatus.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS * 3);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(calls);
  });

  it("本页正在流式 ⇒ 不报 remoteStreaming（输出已接入本页）", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({ streaming: true });

    const { result } = renderHook(() => useWaitState("s10", true));
    await act(async () => {});
    expect(result.current.remoteStreaming).toBe(false);
  });

  it("等待中 seconds 按秒递增（本地计时）", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValue({
      streaming: false,
      yieldState: "waiting",
    });

    const { result } = renderHook(() => useWaitState("s6", false));
    await act(async () => {});
    expect(result.current.seconds).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBeGreaterThanOrEqual(2);
  });

  it("运行态探测信号递增 ⇒ 立即重拉并转入后台运行轮询（session:resumed）", async () => {
    mocks.getSessionRuntimeStatus.mockResolvedValueOnce({ streaming: false });
    const { result, rerender } = renderHook(
      ({ nonce }) => useWaitState("s11", false, nonce),
      { initialProps: { nonce: 0 } },
    );
    await act(async () => {});
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(result.current.remoteStreaming).toBe(false);

    // 审批后续跑启动：后端广播 session:resumed ⇒ 上游递增探测信号
    mocks.getSessionRuntimeStatus.mockResolvedValue({ streaming: true });
    await act(async () => {
      rerender({ nonce: 1 });
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(result.current.remoteStreaming).toBe(true);

    // 命中后台运行后继续按 WAIT_POLL_MS 轮询（直到后端停下）
    await act(async () => {
      vi.advanceTimersByTime(WAIT_POLL_MS);
    });
    expect(mocks.getSessionRuntimeStatus).toHaveBeenCalledTimes(3);
  });

  it("取数失败 ⇒ 不抛错、回落为非等待态（明细由 handleClientError 上报）", async () => {
    mocks.getSessionRuntimeStatus.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useWaitState("s7", false));
    await act(async () => {});

    expect(result.current.waiting).toBe(false);
    expect(result.current.unresolved).toBe(false);
  });
});
