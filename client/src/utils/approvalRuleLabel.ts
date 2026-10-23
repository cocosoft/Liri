/**
 * approvalRuleLabel — 安全审计事件里「自动放行来源」的映射（PR-3c，2026-10-23）
 *
 * 数据源：`GET /v1/security/dashboard` 的 `recentEvents[].matchedRules`
 * （后端由 `PermissionChecker` 写入：`approval:sandbox` / `approval:auto` / `approval:trust`）。
 *
 * 单独成模块（而非写在组件里）⇒ 可被 vitest 直接单测，不必挂载 React。
 */

/** 规则 → i18n 文案 key */
export const APPROVAL_RULE_LABELS: Record<string, string> = {
  "approval:sandbox": "security.ruleSandbox",
  "approval:auto": "security.ruleAutoLocal",
  "approval:trust": "security.ruleTrust",
};

/** 取第一条可识别的自动放行来源（无 ⇒ `undefined`） */
export function approvalRuleOf(
  matchedRules?: string[],
): { rule: string; labelKey: string } | undefined {
  for (const rule of matchedRules ?? []) {
    const labelKey = APPROVAL_RULE_LABELS[rule];
    if (labelKey) return { rule, labelKey };
  }
  return undefined;
}

/** 三类来源的固定顺序（渲染用；与 `APPROVAL_RULE_LABELS` 同源） */
export const APPROVAL_RULES = Object.keys(APPROVAL_RULE_LABELS);

/**
 * 统计「自动放行」事件的来源分布（每条事件**只计一次**，取第一条可识别来源）。
 *
 * 输入为 `GET /v1/security/audit-logs?decision=auto_allowed` 返回的事件数组；
 * 未知/无匹配规则的条目被忽略（`total` 只计已归类的）。
 */
export function countApprovalRules(
  events: ReadonlyArray<{ matchedRules?: string[] }>,
): { total: number; byRule: Record<string, number> } {
  const byRule: Record<string, number> = {};
  for (const rule of APPROVAL_RULES) byRule[rule] = 0;
  let total = 0;
  for (const event of events) {
    const hit = approvalRuleOf(event.matchedRules);
    if (!hit) continue;
    byRule[hit.rule] += 1;
    total += 1;
  }
  return { total, byRule };
}
