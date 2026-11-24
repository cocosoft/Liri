// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * getToolHumanSummary 的时态契约（2026-11-24）
 *
 * 现场：审批已过期、调用未执行的历史工具卡，摘要仍写「正在执行命令…」，
 * 与组头 ⏸ 已中断自相矛盾。现在按 `approvalStatus` 输出「动作短语 +（未执行）」。
 */
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { getToolHumanSummary } from "../utils/toolHumanSummary";
import type { ToolCall } from "../types";

const bash: ToolCall = {
  id: "t1",
  name: "bash",
  arguments: { command: "echo hi" },
};

const presentTense = String(i18n.t("tool.summary.tensePresent"));

describe("getToolHumanSummary 时态（2026-11-24）", () => {
  it("审批已落定但无执行结果 ⇒ 动作短语 +（未执行）", () => {
    const summary = getToolHumanSummary({
      ...bash,
      approvalStatus: "expired",
    });
    expect(summary).toContain(String(i18n.t("tool.summary.notExecutedSuffix")));
    if (presentTense) expect(summary).not.toContain(presentTense);
  });

  it("completed ⇒ 过去式（回归）", () => {
    const summary = getToolHumanSummary({ ...bash, status: "completed" });
    expect(summary).toContain(String(i18n.t("tool.summary.tensePast")));
  });

  it("failed ⇒ 失败后缀（回归）", () => {
    const summary = getToolHumanSummary({ ...bash, status: "failed" });
    expect(summary).toContain(String(i18n.t("tool.summary.failedSuffix")));
  });
});
