import { describe, expect, it } from "vitest";
import {
  registerResumeWaiter,
  resolveResumeWaiter,
  rejectResumeWaiter,
  hasResumeWaiter,
} from "../services/streamPause";

/**
 * streamPause 挂起等待注册表测试（阶段2 断连挂起-恢复）
 * 验证：注册→恢复结算、注册→放弃结算、幂等、同名会话抢占、空注册结算失败。
 */

describe("streamPause 挂起等待注册表 — 阶段2 断连挂起-恢复", () => {
  it("register → resolve：等待 Promise 恢复结算，注册表清空", async () => {
    const waiter = registerResumeWaiter("sess-1");
    expect(hasResumeWaiter("sess-1")).toBe(true);

    let resolved = false;
    waiter.then(() => {
      resolved = true;
    });
    const ok = resolveResumeWaiter("sess-1");
    await waiter;

    expect(ok).toBe(true);
    expect(resolved).toBe(true);
    expect(hasResumeWaiter("sess-1")).toBe(false);
  });

  it("register → reject：等待 Promise 以错误结束（放弃场景）", async () => {
    const waiter = registerResumeWaiter("sess-2");
    const ok = rejectResumeWaiter("sess-2", new Error("用户放弃本次回复"));

    await expect(waiter).rejects.toThrow("用户放弃本次回复");
    expect(ok).toBe(true);
    expect(hasResumeWaiter("sess-2")).toBe(false);
  });

  it("未注册会话的恢复/放弃返回 false（幂等安全）", () => {
    expect(resolveResumeWaiter("ghost")).toBe(false);
    expect(rejectResumeWaiter("ghost", new Error("x"))).toBe(false);
    expect(hasResumeWaiter("ghost")).toBe(false);
  });

  it("同名会话重复注册：拒绝旧等待者，新等待者生效", async () => {
    const first = registerResumeWaiter("sess-3");
    // 第二次注册同会话 → 旧的被拒绝（异常兜底），新的保留
    const second = registerResumeWaiter("sess-3");

    await expect(first).rejects.toThrow("session paused twice");
    expect(hasResumeWaiter("sess-3")).toBe(true);

    expect(resolveResumeWaiter("sess-3")).toBe(true);
    await second;
    expect(hasResumeWaiter("sess-3")).toBe(false);
  });
});
