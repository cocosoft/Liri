/**
 * 规则文件健康 + 命中统计（R0/R5）—— 从 `ToolRulesSection` 原样拆出，文案/类名不变。
 *
 * 按需触发（进入 tab 不打这个只读接口）。观察期未满（`observationComplete=false`）
 * 时**只显示观察期进度**，不得给出「未命中」结论。
 */
import { useTranslation } from "react-i18next";
import type { PermissionRulesHealth } from "../../../services/permissionService";

interface Props {
  isDark: boolean;
  /** 尚未检查过 ⇒ null（只显示按钮） */
  health: PermissionRulesHealth | null;
  /** 拉取中 ⇒ 按钮禁用并显示进行中文案 */
  busy: boolean;
  onCheck: () => void;
}

export default function RuleHealthPanel({
  isDark,
  health,
  busy,
  onCheck,
}: Props) {
  const { t } = useTranslation();
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const inputBg = isDark
    ? "bg-gray-800 border-gray-600 text-gray-200"
    : "bg-white border-gray-300 text-gray-800";

  return (
    <div className="pt-1 space-y-1">
      <button
        type="button"
        onClick={onCheck}
        disabled={busy}
        className={`px-2 py-0.5 text-[11px] rounded border ${inputBg} disabled:opacity-50`}
      >
        {busy
          ? t("settings.toolsRulesHealthChecking")
          : t("settings.toolsRulesHealthCheck")}
      </button>
      {health && (
        <div className={`space-y-0.5 text-[11px] ${muted}`}>
          {health.parseError ? (
            <p className="text-red-600 dark:text-red-400">
              {t("settings.toolsRulesHealthParseError", {
                error: health.parseError,
              })}
            </p>
          ) : (
            <p>
              {t("settings.toolsRulesHealthOk", {
                memory: health.memoryRuleCount,
                conflicts: health.conflicts.length,
              })}
            </p>
          )}
          {health.externalChangeDetected && (
            <p className="text-amber-600 dark:text-amber-400">
              {t("settings.toolsRulesHealthExternalChange")}
            </p>
          )}
          {health.duplicateCount > 0 && (
            <p>
              {t("settings.toolsRulesHealthDuplicates", {
                count: health.duplicateCount,
              })}
            </p>
          )}
          {health.ruleHits.observationComplete ? (
            health.ruleHits.staleRules.length === 0 ? (
              <p>
                {t("settings.toolsRulesHealthNoStale", {
                  days: health.ruleHits.staleDays,
                })}
              </p>
            ) : (
              <div className="space-y-0.5">
                <p>
                  {t("settings.toolsRulesHealthStale", {
                    days: health.ruleHits.staleDays,
                    count: health.ruleHits.staleRules.length,
                  })}
                </p>
                <ul className="list-disc pl-4">
                  {health.ruleHits.staleRules.map((rule) => (
                    <li key={rule.ruleId}>
                      <code>{rule.toolName}</code>
                      <span className="ml-1">{rule.behavior}</span>
                      <span className="ml-1">
                        {rule.lastHitAt
                          ? new Date(rule.lastHitAt).toLocaleDateString()
                          : t("settings.toolsRulesHitNever")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <p>
              {t("settings.toolsRulesHealthObservation", {
                days: health.ruleHits.observationDays,
                staleDays: health.ruleHits.staleDays,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
