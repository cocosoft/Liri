/**
 * PR-3c：安全审计事件「自动放行来源」徽标映射（纯函数）。
 *
 * 断言口径：
 * - 三类来源各映射到自己的文案 key；
 * - 无命中（普通事件 / 空数组 / undefined）⇒ `undefined`（不显示徽标）；
 * - 未知规则被跳过（不误标）。
 */
import { describe, expect, it } from "vitest";

import { approvalRuleOf, countApprovalRules } from "../approvalRuleLabel";

describe("approvalRuleOf", () => {
  it("approval:sandbox ⇒ 沙箱豁免文案", () => {
    expect(approvalRuleOf(["approval:sandbox"])).toEqual({
      rule: "approval:sandbox",
      labelKey: "security.ruleSandbox",
    });
  });

  it("approval:auto ⇒ 会话自动文案", () => {
    expect(approvalRuleOf(["approval:auto"])?.labelKey).toBe(
      "security.ruleAutoLocal",
    );
  });

  it("approval:trust ⇒ 全局信任文案", () => {
    expect(approvalRuleOf(["approval:trust"])?.labelKey).toBe(
      "security.ruleTrust",
    );
  });

  it("普通事件（无匹配规则）⇒ 不显示徽标", () => {
    expect(approvalRuleOf(undefined)).toBeUndefined();
    expect(approvalRuleOf([])).toBeUndefined();
    expect(approvalRuleOf(["path_traversal"])).toBeUndefined();
  });

  it("混合规则 ⇒ 取第一条可识别来源", () => {
    expect(approvalRuleOf(["path_traversal", "approval:auto"])?.rule).toBe(
      "approval:auto",
    );
  });
});

describe("countApprovalRules", () => {
  it("按来源分类计数（每条只计一次）", () => {
    const { total, byRule } = countApprovalRules([
      { matchedRules: ["approval:sandbox"] },
      { matchedRules: ["approval:sandbox"] },
      { matchedRules: ["approval:auto"] },
      { matchedRules: ["approval:trust"] },
      // 同一条同时含两种 ⇒ 只计第一条（sandbox）
      { matchedRules: ["approval:sandbox", "approval:auto"] },
      // 无来源 ⇒ 忽略
      { matchedRules: ["path_traversal"] },
      {},
    ]);
    expect(total).toBe(5);
    expect(byRule).toEqual({
      "approval:sandbox": 3,
      "approval:auto": 1,
      "approval:trust": 1,
    });
  });

  it("空输入 ⇒ 全零（不造假）", () => {
    expect(countApprovalRules([])).toEqual({
      total: 0,
      byRule: {
        "approval:sandbox": 0,
        "approval:auto": 0,
        "approval:trust": 0,
      },
    });
  });
});
