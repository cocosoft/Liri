/**
 * Inbox 回复「是否真的生效」判据（2026-11-04，P0-1 回归）
 *
 * 缺陷现场：`POST /v1/inbox/:id/reply` 对「过期 / 已处理 / 并发冲突」也回 HTTP 200，
 * 组件只看 `res.ok` ⇒ 界面弹「已批准」但后端什么都没做（工作区目录始终没进 workspaceRoots）。
 */
import { describe, expect, it } from "vitest";
import {
  inboxReplyNotAppliedReason,
  isInboxReplyApplied,
} from "../components/ChatArea/inboxReplyResult";

describe("isInboxReplyApplied", () => {
  it("真正生效（返回 Inbox 项，status=replied）⇒ true", () => {
    expect(isInboxReplyApplied({ id: "x", status: "replied", reply: "approve" })).toBe(true);
  });

  it("applied:false 优先（即使 status 看起来正常）⇒ false", () => {
    expect(isInboxReplyApplied({ status: "replied", applied: false })).toBe(false);
  });

  it("expired / already_processed / concurrent_conflict ⇒ false（核心回归）", () => {
    for (const status of ["expired", "already_processed", "concurrent_conflict"]) {
      expect(isInboxReplyApplied({ status })).toBe(false);
    }
  });

  it("空响应体 ⇒ false（不当作成功）", () => {
    expect(isInboxReplyApplied(undefined)).toBe(false);
    expect(isInboxReplyApplied(null)).toBe(false);
    expect(isInboxReplyApplied("ok")).toBe(false);
  });
});

describe("inboxReplyNotAppliedReason", () => {
  it("后端 message 优先", () => {
    expect(
      inboxReplyNotAppliedReason({ status: "expired", message: "该审批已超时，无法处理" })
    ).toBe("该审批已超时，无法处理");
  });

  it("无 message 时按状态给出可读原因", () => {
    expect(inboxReplyNotAppliedReason({ status: "expired" })).toContain("超时");
    expect(inboxReplyNotAppliedReason({ status: "already_processed" })).toContain("已处理");
    expect(inboxReplyNotAppliedReason({ status: "concurrent_conflict" })).toContain("稍后");
  });

  it("未知状态 ⇒ undefined（由调用方回退到通用失败文案）", () => {
    expect(inboxReplyNotAppliedReason({ status: "weird" })).toBeUndefined();
  });
});
