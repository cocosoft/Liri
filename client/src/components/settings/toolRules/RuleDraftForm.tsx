/**
 * 「未收录命令 → 新增规则」表单 —— 从 `ToolRulesSection` 原样拆出，文案/类名不变。
 *
 * 工具名需用户填（后端样本只记命令原文，不猜方言）；保存前的 409 影响预演
 * 二次确认由父组件承担，本组件只负责受控输入与提交/取消。
 */
import { useTranslation } from "react-i18next";

/** 未收录命令 → 新增命令规则的表单草稿 */
export interface RuleDraft {
  behavior: "allow" | "ask" | "deny";
  toolName: string;
  contentPattern: string;
}

interface Props {
  isDark: boolean;
  draft: RuleDraft;
  /** 任一写操作进行中 ⇒ 保存按钮禁用 */
  busy: boolean;
  onChange: (patch: Partial<RuleDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function RuleDraftForm({
  isDark,
  draft,
  busy,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const rowBg = isDark ? "bg-gray-800/60" : "bg-gray-50";
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const inputBg = isDark
    ? "bg-gray-800 border-gray-600 text-gray-200"
    : "bg-white border-gray-300 text-gray-800";

  return (
    <div className={`rounded-lg p-3 space-y-2 ${rowBg}`}>
      <p className={`text-xs font-medium ${muted}`}>
        {t("settings.toolsRulesAddTitle")}
      </p>
      <div className="flex gap-2">
        <select
          value={draft.behavior}
          onChange={(e) =>
            onChange({ behavior: e.target.value as RuleDraft["behavior"] })
          }
          className={`px-1.5 py-0.5 text-xs rounded border ${inputBg}`}
          aria-label={t("settings.toolsRulesAddTitle")}
        >
          <option value="allow">{t("settings.toolsRulesBehaviorAllow")}</option>
          <option value="ask">{t("settings.toolsRulesBehaviorAsk")}</option>
          <option value="deny">{t("settings.toolsRulesBehaviorDeny")}</option>
        </select>
        <input
          value={draft.toolName}
          onChange={(e) => onChange({ toolName: e.target.value })}
          placeholder={t("permission.toolNamePlaceholder")}
          className={`flex-1 px-2 py-1 text-xs rounded border ${inputBg}`}
        />
        <input
          value={draft.contentPattern}
          onChange={(e) => onChange({ contentPattern: e.target.value })}
          placeholder={t("permission.contentPatternPlaceholder")}
          className={`flex-1 px-2 py-1 text-xs rounded border ${inputBg}`}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !draft.toolName.trim()}
          className="px-2 py-0.5 text-[11px] rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        >
          {t("settings.toolsRulesAddSave")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`px-2 py-0.5 text-[11px] rounded border ${inputBg}`}
        >
          {t("settings.toolsRulesAddCancel")}
        </button>
      </div>
    </div>
  );
}
