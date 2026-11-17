/**
 * 未收录命令提示（R5）—— 从 `ToolRulesSection` 原样拆出，文案/类名不变。
 *
 * 数据来自后端近 N 天转审批样本（`unknownCommandSuggestions`）；无样本时父组件
 * 不渲染本组件（此处不再兜底判断"是否有样本"，只按 `headCount > 0` 的门槛渲染）。
 */
import { useTranslation } from "react-i18next";
import type { UnknownCommandSuggestions } from "../../../services/permissionService";

interface Props {
  isDark: boolean;
  suggestions: UnknownCommandSuggestions;
  /** 点某条命令 ⇒ 以该命令为 `contentPattern` 打开新增表单 */
  onPick: (head: string) => void;
}

export default function UnknownCommandPanel({
  isDark,
  suggestions,
  onPick,
}: Props) {
  const { t } = useTranslation();
  const muted = isDark ? "text-gray-400" : "text-gray-500";

  if (suggestions.headCount <= 0) return null;

  return (
    <div
      className={`rounded-lg p-3 space-y-1 ${
        isDark ? "bg-amber-500/10" : "bg-amber-50"
      }`}
    >
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        {t("settings.toolsRulesUnknownTitle", {
          days: suggestions.sinceDays,
          headCount: suggestions.headCount,
          sampleCount: suggestions.sampleCount,
        })}
      </p>
      <p className={`text-[11px] ${muted}`}>
        {t("settings.toolsRulesUnknownHint")}
      </p>
      <div className="flex flex-wrap gap-1 pt-1">
        {suggestions.topHeads.map((entry) => (
          <button
            key={entry.head}
            type="button"
            title={entry.latestSurface}
            onClick={() => onPick(entry.head)}
            className={`text-[11px] px-2 py-0.5 rounded border ${
              isDark
                ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                : "border-amber-400 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <code>{entry.head}</code> ×{entry.count} ·{" "}
            {t("settings.toolsRulesUnknownAdd")}
          </button>
        ))}
      </div>
    </div>
  );
}
