/**
 * `useRunClock` + `streamHeartbeat` 单测（2026-11-18 Run HUD）
 *
 * 背景：用户反馈「前端看不出你在运行，以为挂了」——状态条只有静态文案，
 * 无时间证据、也看不出链路是否还活着。这里锁定三件事：
 * ① 后端 `: heartbeat` 注释行能被识别并登记为**按会话**的时间戳；
 * ② 停滞判定只在「有基线 + 静默超阈值」时成立（不猜、不误报）；
 * ③ 秒表/心跳年龄都来自真实计时。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { deriveRunStalled, useRunClock } from "../useRunClock";
import {
  getStreamHeartbeatAt,
  isSseHeartbeatComment,
  noteStreamHeartbeat,
  resetStreamHeartbeat,
  STREAM_BEAT_STALL_MS,
} from "../../services/streamHeartbeat";
import { useChatStore } from "../../stores/chat";

const SID = "session-under-test";

describe("streamHeartbeat 心跳登记", () => {
  beforeEach(() => {
    resetStreamHeartbeat(SID);
    resetStreamHeartbeat("other-session");
  });

  it("识别后端保活注释行（`: heartbeat` / `:heartbeat`），其余忽略", () => {
    expect(isSseHeartbeatComment(": heartbeat")).toBe(true);
    expect(isSseHeartbeatComment(":heartbeat")).toBe(true);
    expect(isSseHeartbeatComment("  :  heartbeat  ")).toBe(true);
    expect(isSseHeartbeatComment(": ping")).toBe(false);
    expect(isSseHeartbeatComment("data: {}")).toBe(false);
    expect(isSseHeartbeatComment("")).toBe(false);
  });

  it("按会话分键登记，重置只清本会话（不得用别的会话说心跳还在）", () => {
    noteStreamHeartbeat(SID, 1_000);
    noteStreamHeartbeat("other-session", 2_000);
    expect(getStreamHeartbeatAt(SID)).toBe(1_000);
    expect(getStreamHeartbeatAt("other-session")).toBe(2_000);

    resetStreamHeartbeat(SID);
    expect(getStreamHeartbeatAt(SID)).toBeNull();
    expect(getStreamHeartbeatAt("other-session")).toBe(2_000);
  });

  it("未登记的会话返回 null（不造 0 基线）", () => {
    expect(getStreamHeartbeatAt("never-seen")).toBeNull();
  });
});

describe("deriveRunStalled 停滞判定", () => {
  it("无基线（null）不判停滞", () => {
    expect(deriveRunStalled(true, null)).toBe(false);
  });

  it("非流式阶段（无心跳来源）不判停滞", () => {
    expect(deriveRunStalled(false, STREAM_BEAT_STALL_MS * 10)).toBe(false);
  });

  it("达到阈值为停滞，差 1ms 不算", () => {
    expect(deriveRunStalled(true, STREAM_BEAT_STALL_MS - 1)).toBe(false);
    expect(deriveRunStalled(true, STREAM_BEAT_STALL_MS)).toBe(true);
  });
});

describe("useRunClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
    resetStreamHeartbeat(SID);
  });

  afterEach(() => {
    vi.useRealTimers();
    useChatStore.setState({
      isSending: false,
      isStreaming: false,
      isUploading: false,
    });
  });

  it("运行秒表与心跳年龄随时钟推进；静默超阈值切停滞", () => {
    useChatStore.setState({ isStreaming: true });
    noteStreamHeartbeat(SID, Date.now());

    const { result } = renderHook(() => useRunClock(SID));
    expect(result.current.active).toBe(true);
    expect(result.current.elapsedSeconds).toBe(0);
    expect(result.current.beatAgeSeconds).toBe(0);
    expect(result.current.stalled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.elapsedSeconds).toBe(30);
    expect(result.current.beatAgeSeconds).toBe(30);
    expect(result.current.stalled).toBe(false);

    // 再静默 60s ⇒ 距最后一次心跳 90s（= STREAM_BEAT_STALL_MS）⇒ 停滞
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.beatAgeSeconds).toBe(90);
    expect(result.current.stalled).toBe(true);
  });

  it("新一轮心跳到达 ⇒ 年龄归零、停滞解除", () => {
    useChatStore.setState({ isStreaming: true });
    noteStreamHeartbeat(SID, Date.now());

    const { result } = renderHook(() => useRunClock(SID));
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current.stalled).toBe(true);

    act(() => {
      noteStreamHeartbeat(SID, Date.now());
    });
    expect(result.current.beatAgeSeconds).toBe(0);
    expect(result.current.stalled).toBe(false);
    // 秒表是「本轮运行时长」，不因心跳重置而归零
    expect(result.current.elapsedSeconds).toBe(120);
  });

  it("从未收到心跳 ⇒ 只显示秒表，不报「N 秒前」也不报停滞", () => {
    useChatStore.setState({ isStreaming: true });

    const { result } = renderHook(() => useRunClock(SID));
    act(() => {
      vi.advanceTimersByTime(200_000);
    });
    expect(result.current.beatAgeSeconds).toBeNull();
    expect(result.current.stalled).toBe(false);
  });

  it("非流式（仅上传）不把旧心跳当作活性证据", () => {
    useChatStore.setState({ isUploading: true });
    noteStreamHeartbeat(SID, Date.now() - 600_000);

    const { result } = renderHook(() => useRunClock(SID));
    expect(result.current.active).toBe(true);
    expect(result.current.beatAgeSeconds).toBeNull();
    expect(result.current.stalled).toBe(false);
  });
});
