// R3：规则约束强度徽标（🔴必须 / 🟡应 / 🔵可）
import { useTranslation } from "react-i18next";
import type { BucketedRuleItem } from "../../types";

const MAP: Record<
  BucketedRuleItem["constraintStrength"],
  { emoji: string; labelKey: string; cls: string }
> = {
  mandatory: {
    emoji: "🔴",
    labelKey: "knowledge.strengthMandatory",
    cls: "text-red-600 dark:text-red-400",
  },
  should: {
    emoji: "🟡",
    labelKey: "knowledge.strengthShould",
    cls: "text-amber-600 dark:text-amber-400",
  },
  may: {
    emoji: "🔵",
    labelKey: "knowledge.strengthMay",
    cls: "text-blue-600 dark:text-blue-400",
  },
};

export function StrengthBadge({
  strength,
}: {
  strength: BucketedRuleItem["constraintStrength"];
}) {
  const { t } = useTranslation();
  const m = MAP[strength] ?? MAP.should;
  const label = t(m.labelKey);
  return (
    <span
      title={t("knowledge.constraintStrengthTooltip", { strength: label })}
      className={`inline-flex items-center gap-0.5 text-[10px] leading-none ${m.cls}`}
    >
      <span aria-hidden>{m.emoji}</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}
