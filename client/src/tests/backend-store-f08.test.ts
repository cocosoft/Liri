// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F-08（2026-10-29）：底栏 Backend 状态抖动回归锁。
 *
 * 浏览器模式下 `chatService.getBackendStatus()` 等价于**单次** `/health` 探测，
 * 原实现一次失败就把「运行中」翻成「已停止」，下一次 5s 轮询又翻回来
 * （真机可见状态跳变）。修复后：连续 3 次失败才判停，成功一次即清零。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getBackendStatus = vi.fn();
vi.mock("../services/chatService", () => ({
  chatService: {
    getBackendStatus: (...args: unknown[]) => getBackendStatus(...args),
  },
}));

import { useBackendStore } from "../stores/backendStore";

const check = () => useBackendStore.getState().checkStatus();
const running = () => useBackendStore.getState().status.running;

describe("backendStore.checkStatus（F-08 状态不抖动）", () => {
  beforeEach(async () => {
    getBackendStatus.mockReset();
    useBackendStore.setState({
      isBrowserMode: true,
      status: { running: true, port: 18990 },
      error: null,
    });
    // 以一次成功探测复位模块级连续失败计数（避免用例间串扰）
    getBackendStatus.mockResolvedValueOnce({ running: true, port: 18990 });
    await check();
    expect(running()).toBe(true);
  });

  it("单次探测失败不翻成「已停止」", async () => {
    getBackendStatus.mockResolvedValueOnce({ running: false, port: null });
    await check();
    expect(running()).toBe(true);
  });

  it("连续 3 次失败才判停", async () => {
    getBackendStatus.mockResolvedValue({ running: false, port: null });
    await check();
    expect(running()).toBe(true);
    await check();
    expect(running()).toBe(true);
    await check();
    expect(running()).toBe(false);
  });

  it("判停后一次成功即恢复「运行中」", async () => {
    getBackendStatus.mockResolvedValue({ running: false, port: null });
    await check();
    await check();
    await check();
    expect(running()).toBe(false);
    getBackendStatus.mockResolvedValueOnce({ running: true, port: 18990 });
    await check();
    expect(running()).toBe(true);
  });
});
