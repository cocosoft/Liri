import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ConnectionState,
  isAllowedConnectionTransition,
  connectionMonitor,
} from "../services/connectionMonitor";

// healthCheckOnce 已迁到统一 http 客户端（W6 闭环：Tauri 下由 Rust 注入
// X-API-Key，浏览器直连 fetch）——测试直接 mock ./httpClient，验证健康探测
// 语义（ok→true / 非ok→false / 异常→false），而非打桩全局 fetch。
vi.mock("../services/httpClient", () => ({
  http: { get: vi.fn() },
}));

import { http } from "../services/httpClient";

/**
 * ConnectionMonitor 状态机规则测试（§十 阶段 C Connection 域）
 * 验证：核心转移合法（掉线/恢复/断网/重连）、非法转移拒绝、状态自反。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connectionMonitor 状态机规则 — §十 阶段 C Connection 域", () => {
  it("CONNECTED → DISCONNECTED（后端掉线）合法", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.CONNECTED,
        ConnectionState.DISCONNECTED,
      ),
    ).toBe(true);
  });

  it("DISCONNECTED → CONNECTED（后端恢复）合法", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.DISCONNECTED,
        ConnectionState.CONNECTED,
      ),
    ).toBe(true);
  });

  it("任意状态 → OFFLINE（网络断开）合法", () => {
    for (const s of [
      ConnectionState.CONNECTED,
      ConnectionState.DISCONNECTED,
      ConnectionState.RECONNECTING,
    ]) {
      expect(isAllowedConnectionTransition(s, ConnectionState.OFFLINE)).toBe(
        true,
      );
    }
  });

  it("OFFLINE → CONNECTED（网络恢复 + 后端可达）合法", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.OFFLINE,
        ConnectionState.CONNECTED,
      ),
    ).toBe(true);
  });

  it("OFFLINE → DISCONNECTED（网络恢复 + 后端不可达）合法", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.OFFLINE,
        ConnectionState.DISCONNECTED,
      ),
    ).toBe(true);
  });

  it("DISCONNECTED → RECONNECTING（尝试恢复）合法", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.DISCONNECTED,
        ConnectionState.RECONNECTING,
      ),
    ).toBe(true);
  });

  it("CONNECTED → RECONNECTING 非法（恢复仅从 DISCONNECTED 发起）", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.CONNECTED,
        ConnectionState.RECONNECTING,
      ),
    ).toBe(false);
  });

  it("RECONNECTING → CONNECTED 合法", () => {
    expect(
      isAllowedConnectionTransition(
        ConnectionState.RECONNECTING,
        ConnectionState.CONNECTED,
      ),
    ).toBe(true);
  });

  it("自反转移合法（同状态视为无操作，不抛错）", () => {
    for (const s of [
      ConnectionState.CONNECTED,
      ConnectionState.DISCONNECTED,
      ConnectionState.OFFLINE,
      ConnectionState.RECONNECTING,
    ]) {
      expect(isAllowedConnectionTransition(s, s)).toBe(true);
    }
  });
});

describe("connectionMonitor.healthCheckOnce — N8-1 自动恢复探测（<30s 最短掉线场景）", () => {
  it("/health 返回 ok → true", async () => {
    vi.mocked(http.get).mockResolvedValue({ ok: true, data: undefined });

    await expect(connectionMonitor.healthCheckOnce()).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledWith(
      "/health",
      expect.objectContaining({ timeout: expect.anything() }),
    );
  });

  it("/health 返回非 ok（如 500）→ false", async () => {
    vi.mocked(http.get).mockResolvedValue({
      ok: false,
      error: { code: 500, message: "internal error" },
    });

    await expect(connectionMonitor.healthCheckOnce()).resolves.toBe(false);
  });

  it("网络异常（fetch 抛错）→ false（不抛出）", async () => {
    vi.mocked(http.get).mockRejectedValue(new Error("network down"));

    await expect(connectionMonitor.healthCheckOnce()).resolves.toBe(false);
  });
});
