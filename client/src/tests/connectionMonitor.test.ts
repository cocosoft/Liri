import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ConnectionState,
  isAllowedConnectionTransition,
  connectionMonitor,
} from "../services/connectionMonitor";

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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectionMonitor.healthCheckOnce()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("/health 返回非 ok（如 500）→ false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(connectionMonitor.healthCheckOnce()).resolves.toBe(false);
  });

  it("网络异常（fetch 抛错）→ false（不抛出）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(connectionMonitor.healthCheckOnce()).resolves.toBe(false);
  });
});
