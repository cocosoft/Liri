/**
 * 2026-11-19（用户反馈）：全局信任级别提示条**只是提示**，不应常驻界面 ⇒ 改为可关闭。
 *
 * 契约：
 *  ① 未配置 `defaultTrustLevel` ⇒ 不渲染（零噪音）；
 *  ② 有配置 ⇒ 渲染提示 + 关闭按钮；点关闭后消失，并把**当前级别**记入 localStorage；
 *  ③ 已记录同级别 ⇒ 下次（含重启）直接不显示；
 *  ④ 记录的是**别的**级别 ⇒ 仍显示（`--trust-level` 变了要重新告知）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("../../../services/httpClient", () => ({
  http: { get: (...args: unknown[]) => mockGet(...args) },
  httpLegacy: { get: (...args: unknown[]) => mockGet(...args) },
}));

import GlobalTrustNoticeBar from "../GlobalTrustNoticeBar";

const KEY = "liri-trust-notice-dismissed-level";

function config(defaultTrustLevel?: string) {
  return {
    key: "permission",
    value: defaultTrustLevel ? { defaultTrustLevel } : {},
  };
}

describe("GlobalTrustNoticeBar：可关闭的一次性提示", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("未配置 defaultTrustLevel ⇒ 不渲染", async () => {
    mockGet.mockResolvedValue(config());
    const { container } = render(<GlobalTrustNoticeBar />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container.textContent ?? "").not.toContain("全局信任级别");
  });

  it("已配置 ⇒ 渲染提示；点关闭 ⇒ 消失并记住该级别", async () => {
    mockGet.mockResolvedValue(config("chat"));
    const { container } = render(<GlobalTrustNoticeBar />);

    await waitFor(() =>
      expect(container.textContent ?? "").toContain("全局信任级别"),
    );
    expect(localStorage.getItem(KEY)).toBeNull();

    fireEvent.click(screen.getByLabelText("关闭"));

    expect(container.textContent ?? "").not.toContain("全局信任级别");
    expect(localStorage.getItem(KEY)).toBe("chat");
  });

  it("已记录同级别 ⇒ 直接不显示", async () => {
    localStorage.setItem(KEY, "chat");
    mockGet.mockResolvedValue(config("chat"));
    const { container } = render(<GlobalTrustNoticeBar />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.textContent ?? "").not.toContain("全局信任级别"),
    );
  });

  it("记录的是别的级别 ⇒ 仍显示（姿态变了要再告知）", async () => {
    localStorage.setItem(KEY, "work");
    mockGet.mockResolvedValue(config("chat"));
    const { container } = render(<GlobalTrustNoticeBar />);
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("全局信任级别"),
    );
  });
});
