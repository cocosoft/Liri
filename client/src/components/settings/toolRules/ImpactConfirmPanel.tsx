/**
 * 影响预演阻断后的二次确认面板（写接口 409 `error.code='impact'`）。
 *
 * 从 `ToolRulesSection` 原样拆出，文案/类名不变。后端在 409 时**未写任何状态**，
 * 所以「仍然保存」= 用同一意图带 `confirmImpact=true` 重新提交。
 */
import { useTranslation } from "react-i18next";
import type { RuleImpactPreview } from "../../../services/permissionService";

/** 影响预演阻断后的待确认动作（409 未写任何状态 ⇒ 重试即重新提交同一意图） */
export interface PendingImpact {
  message: string;
  impact: RuleImpactPreview;
  retry: () => Promise<void>;
}

interface Props {
  isDark: boolean;
  pending: PendingImpact;
  /** 任一写操作进行中 ⇒ 确认按钮禁用（避免并发提交） */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ImpactConfirmPanel({
  isDark,
  pending,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const inputBg = isDark
    ? "bg-gray-800 border-gray-600 text-gray-200"
    : "bg-white border-gray-300 text-gray-800";

  return (
    <div
      className={`rounded-lg p-3 space-y-1 border ${
        isDark
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-amber-400 bg-amber-50"
      }`}
    >
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        {t("settings.toolsRulesImpactTitle", {
          count: pending.impact.degradedCommands.length,
        })}
      </p>
      <ul className={`text-[11px] list-disc pl-4 ${muted}`}>
        {pending.impact.degradedCommands.map((command) => (
          <li key={command}>
            <code>{command}</code>
          </li>
        ))}
      </ul>
      <p className={`text-[11px] ${muted}`}>{pending.message}</p>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-2 py-0.5 text-[11px] rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
        >
          {t("settings.toolsRulesImpactConfirm")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`px-2 py-0.5 text-[11px] rounded border ${inputBg}`}
        >
          {t("settings.toolsRulesImpactCancel")}
        </button>
      </div>
    </div>
  );
}
