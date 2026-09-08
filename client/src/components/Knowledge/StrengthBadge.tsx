// R3：规则约束强度徽标（🔴必须 / 🟡应 / 🔵可）
import type { BucketedRuleItem } from "../../types";

const MAP: Record<
  BucketedRuleItem["constraintStrength"],
  { emoji: string; label: string; cls: string }
> = {
  mandatory: { emoji: "🔴", label: "必须", cls: "text-red-600 dark:text-red-400" },
  should: { emoji: "🟡", label: "应", cls: "text-amber-600 dark:text-amber-400" },
  may: { emoji: "🔵", label: "可", cls: "text-blue-600 dark:text-blue-400" },
};

export function StrengthBadge({
  strength,
}: {
  strength: BucketedRuleItem["constraintStrength"];
}) {
  const m = MAP[strength] ?? MAP.should;
  return (
    <span
      title={`约束强度: ${m.label}`}
      className={`inline-flex items-center gap-0.5 text-[10px] leading-none ${m.cls}`}
    >
      <span aria-hidden>{m.emoji}</span>
      <span className="font-medium">{m.label}</span>
    </span>
  );
}
