// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-04（2026-10-19）：SSE 链路健康判定。
 *
 * 回归点：`isConnected()` 原实现只判 `streamController !== null`（fetch 发起前就赋值）
 * ⇒ 半开连接/TCP 假活时恒为 true，`visibilitychange` 早退、永不重连。
 */
import { afterEach, describe, expect, it } from "vitest";
import { sseService } from "../sseService";

interface HealthProbe {
  streamController: AbortController | null;
  lastEventAt: number;
}

const probe = sseService as unknown as HealthProbe;

describe("sseService.isConnected — 链路健康判定（U-04）", () => {
  afterEach(() => {
    probe.streamController = null;
    probe.lastEventAt = 0;
  });

  it("无连接句柄 ⇒ false", () => {
    probe.streamController = null;
    probe.lastEventAt = Date.now();
    expect(sseService.isConnected()).toBe(false);
  });

  it("刚发起、尚未收到首块 ⇒ true（握手宽限）", () => {
    probe.streamController = new AbortController();
    probe.lastEventAt = 0;
    expect(sseService.isConnected()).toBe(true);
  });

  it("45s 内收到过数据 ⇒ true", () => {
    probe.streamController = new AbortController();
    probe.lastEventAt = Date.now() - 10_000;
    expect(sseService.isConnected()).toBe(true);
  });

  it("超过 45s 无任何数据 ⇒ false（假连接）", () => {
    probe.streamController = new AbortController();
    probe.lastEventAt = Date.now() - 60_000;
    expect(sseService.isConnected()).toBe(false);
  });
});
