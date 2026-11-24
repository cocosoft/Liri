// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 批次 4 / B3（2026-11-24）：工具结果态**单一派生**的表格驱动用例。
 *
 * 守护的缺口：同一工具调用在组头 / 工具卡 / 行内标签 / 日志面板各自判状态
 * （3–4 套判据）⇒ 真机同一调用可同时显示「已完成」「已中断」「未知」。
 */
import { describe, expect, it } from "vitest";
import { deriveGroupOutcome, deriveToolOutcome } from "../toolOutcome";

describe("deriveToolOutcome（工具结果态单一派生）", () => {
  it("无调用对象 ⇒ unknown（不臆造状态）", () => {
    expect(deriveToolOutcome(undefined)).toBe("unknown");
  });

  it("待审批（标记在、卡未落定）⇒ pending_approval，优先于 running", () => {
    expect(
      deriveToolOutcome(
        { status: "running", pendingApproval: true, inboxId: "inbox-1" },
        { isStreaming: true, resolvedInboxIds: new Set<string>() },
      ),
    ).toBe("pending_approval");
  });

  it("审批已落定（inboxId 在已落定集合里）⇒ 不再算待审批", () => {
    expect(
      deriveToolOutcome(
        { status: "running", pendingApproval: true, inboxId: "inbox-1" },
        { isStreaming: true, resolvedInboxIds: new Set(["inbox-1"]) },
      ),
    ).toBe("running");
    expect(
      deriveToolOutcome(
        { pendingApproval: true, inboxId: "inbox-1" },
        { resolvedInboxIds: new Set(["inbox-1"]) },
      ),
    ).toBe("interrupted");
  });

  it("running：流式中 ⇒ running；流已结束仍 running ⇒ interrupted", () => {
    expect(
      deriveToolOutcome({ status: "running" }, { isStreaming: true }),
    ).toBe("running");
    expect(
      deriveToolOutcome({ status: "running" }, { isStreaming: false }),
    ).toBe("interrupted");
    // 未显式给 isStreaming ⇒ 不擅自推断，保持 running
    expect(deriveToolOutcome({ status: "running" })).toBe("running");
  });

  it("终态：failed / completed / canceled", () => {
    expect(deriveToolOutcome({ status: "failed" })).toBe("failed");
    expect(deriveToolOutcome({ status: "completed" })).toBe("completed");
    expect(deriveToolOutcome({ status: "canceled" })).toBe("interrupted");
  });

  it("无显式状态但有结果 ⇒ completed；无状态无结果 ⇒ interrupted", () => {
    expect(deriveToolOutcome({ result: "ok" })).toBe("completed");
    expect(deriveToolOutcome({})).toBe("interrupted");
  });
});

describe("deriveGroupOutcome（组头聚合）", () => {
  const call = (
    status?: string,
    extra: { pendingApproval?: boolean; isStreaming?: boolean } = {},
  ) => ({
    type: "tool_call",
    isStreaming: extra.isStreaming,
    toolCall: { status, pendingApproval: extra.pendingApproval },
  });

  it("无工具调用 ⇒ empty（不谎报 completed）", () => {
    expect(deriveGroupOutcome([])).toBe("empty");
    expect(deriveGroupOutcome([{ type: "text" }])).toBe("empty");
  });

  it("优先级：running > pending_approval > failed > interrupted > completed", () => {
    expect(
      deriveGroupOutcome([
        call("completed"),
        call("running", { isStreaming: true }),
      ]),
    ).toBe("running");
    expect(
      deriveGroupOutcome([
        call("completed"),
        call("running", { pendingApproval: true }),
      ]),
    ).toBe("pending_approval");
    expect(deriveGroupOutcome([call("completed"), call("failed")])).toBe(
      "failed",
    );
    expect(deriveGroupOutcome([call("completed"), call(undefined)])).toBe(
      "interrupted",
    );
    expect(deriveGroupOutcome([call("completed"), call("completed")])).toBe(
      "completed",
    );
  });
});
