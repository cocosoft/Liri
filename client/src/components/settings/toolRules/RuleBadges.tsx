/**
 * 规则展示徽标（R0/R3/R5）—— 从 `ToolRulesSection` 原样拆出，文案/类名/渲染条件不变。
 *
 * 三个徽标都**只展示后端给的字段**：字段缺省 ⇒ 不渲染（不猜、不显示假 0）。
 */
import { useTranslation } from "react-i18next";
import type {
  PermissionRule,
  PermissionRuleScope,
} from "../../../services/permissionService";

interface RuleBadgeProps {
  rule: PermissionRule;
  isDark: boolean;
}

interface HitBadgeProps {
  /** 工具行可能没有规则（`ruleOf()` 未命中）⇒ 不渲染 */
  rule: PermissionRule | undefined;
  isDark: boolean;
}

/**
 * R0：规则作用域徽标 —— 让用户看清"这条规则管多大范围"。
 * 缺省（旧接口 / settings 来源）⇒ 不渲染，不猜。
 */
export function ScopeBadge({ rule }: Omit<RuleBadgeProps, "isDark">) {
  const { t } = useTranslation();
  const label = (() => {
    switch (rule.scope as PermissionRuleScope | undefined) {
      case "session":
        return t("settings.toolsRulesScopeSession");
      case "workspace":
        return t("settings.toolsRulesScopeWorkspace");
      case "tool":
        return t("settings.toolsRulesScopeTool");
      case "global":
        return t("settings.toolsRulesScopeGlobal");
      default:
        return null;
    }
  })();
  if (!label) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-500 dark:text-gray-400 shrink-0">
      {label}
    </span>
  );
}

/** R3：审批时间（审批生成规则才有；缺省 ⇒ 不渲染，非法时间同样不渲染） */
export function ApprovedBadge({ rule, isDark }: RuleBadgeProps) {
  const { t } = useTranslation();
  if (!rule.approvedAt) return null;
  const at = new Date(rule.approvedAt);
  if (Number.isNaN(at.getTime())) return null;
  const label = t("settings.toolsRulesApprovedAt", {
    time: at.toLocaleString(),
  });
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  return (
    <span className={`text-[10px] shrink-0 ${muted}`} title={label}>
      {label}
    </span>
  );
}

/**
 * R5：命中统计徽标。
 *
 * `hitCount` 缺省（settings 来源）⇒ 不渲染（不显示假 0）；
 * `0` ⇒ 「尚未命中」；`>0` ⇒ 次数 + 最近命中时间（tooltip）。
 */
export function HitBadge({ rule, isDark }: HitBadgeProps) {
  const { t } = useTranslation();
  if (!rule || rule.hitCount === undefined) return null;
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const lastHit = rule.lastHitAt
    ? new Date(rule.lastHitAt).toLocaleString()
    : null;
  return (
    <span
      className={`text-[10px] shrink-0 ${muted}`}
      title={
        lastHit
          ? t("settings.toolsRulesLastHit", { time: lastHit })
          : t("settings.toolsRulesHitNever")
      }
    >
      {rule.hitCount > 0
        ? t("settings.toolsRulesHitCount", { count: rule.hitCount })
        : t("settings.toolsRulesHitNever")}
    </span>
  );
}
