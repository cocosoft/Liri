/**
 * ToolRulesSection — 设置 → 自定义规则 →「工具」tab（PR-2，2026-10-23）
 *
 * 用户点名的能力：**工具级 allow / ask / deny 名单**。
 *
 * 落点唯一：直接读写 `tool_rules.json`（`/v1/permissions/rules`）——
 * 这是 `PermissionChecker` 决策主链路真正消费的那一份，不新建第二套存储。
 *
 * 分层：
 * - 「工具级」= 无 `contentPattern` / 无 `inputFingerprint` 的规则（整工具生效）；
 * - 「已记住的审批」= 带 `inputFingerprint` 的规则（「始终允许」按工具+参数指纹，
 *   由 Inbox 审批卡写入），此处只做展示与撤销。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SharedToolVisibilityEntry } from "@shared/types";
import { toolService } from "../../services/toolService";
import {
  permissionService,
  type PermissionRule,
} from "../../services/permissionService";
import { handleClientError } from "../../utils/handleError";

type Behavior = "default" | "allow" | "ask" | "deny";

interface Props {
  isDark: boolean;
}

/** 工具级规则（整工具生效；指纹/内容规则不在此列；只读的 settings 规则也不在此列） */
function isToolLevelRule(rule: PermissionRule): boolean {
  return !rule.readOnly && !rule.inputFingerprint && !rule.contentPattern;
}

export default function ToolRulesSection({ isDark }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SharedToolVisibilityEntry[]>([]);
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const reload = async () => {
    const [nextEntries, nextRules] = await Promise.all([
      toolService.visibility(),
      permissionService.listRules(),
    ]);
    setEntries(nextEntries);
    setRules(nextRules.rules ?? []);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await reload();
        setError(null);
      } catch (e) {
        handleClientError(e, {
          module: "components:settings:ToolRules",
          action: "load",
        });
        setError(t("settings.toolsRulesLoadFailed"));
      } finally {
        setLoading(false);
      }
    })();
    // 仅在挂载时加载；切 tab 由父组件卸载/重挂载保证重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toolLevelRules = useMemo(() => rules.filter(isToolLevelRule), [rules]);
  const fingerprintRules = useMemo(
    () => rules.filter((r) => !!r.inputFingerprint),
    [rules],
  );
  /** settings 文件来源（只读合并视图）：展示真实生效值，但不在本面板写入 */
  const settingsRules = useMemo(
    () =>
      rules.filter(
        (r) => r.readOnly && !r.inputFingerprint && !r.contentPattern,
      ),
    [rules],
  );

  const ruleOf = (name: string): PermissionRule | undefined =>
    toolLevelRules.find((r) => r.toolName === name);

  const settingsRuleOf = (name: string): PermissionRule | undefined =>
    settingsRules.find((r) => r.toolName === name);

  const behaviorOf = (name: string): Behavior => {
    const rule = ruleOf(name) ?? settingsRuleOf(name);
    return rule ? (rule.behavior as Behavior) : "default";
  };

  const changeBehavior = async (name: string, next: Behavior) => {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      const existing = ruleOf(name);
      if (existing) await permissionService.deleteRule(existing.id);
      if (next !== "default") await permissionService.addRule(next, name);
      await reload();
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:ToolRules",
        action: "changeBehavior",
      });
      setError(t("settings.toolsRulesSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const deleteRule = async (rule: PermissionRule) => {
    if (busy) return;
    setBusy(rule.id);
    setError(null);
    try {
      await permissionService.deleteRule(rule.id);
      await reload();
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:ToolRules",
        action: "deleteRule",
      });
      setError(t("settings.toolsRulesSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const visibleEntries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const list = keyword
      ? entries.filter((e) => e.name.toLowerCase().includes(keyword))
      : entries;
    const riskRank: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
      unknown: 3,
    };
    return [...list].sort(
      (a, b) =>
        (riskRank[a.risk] ?? 9) - (riskRank[b.risk] ?? 9) ||
        a.name.localeCompare(b.name),
    );
  }, [entries, search]);

  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const rowBg = isDark ? "bg-gray-800/60" : "bg-gray-50";

  const riskLabel = (risk: string): string | null => {
    if (risk === "high") return t("settings.toolsRiskHigh");
    if (risk === "medium") return t("settings.toolsRiskMedium");
    if (risk === "unknown") return t("settings.toolsRiskUnknown");
    return null;
  };

  if (loading) {
    return (
      <p className={`py-3 text-xs ${muted}`}>
        {t("settings.toolsRulesLoading")}
      </p>
    );
  }

  return (
    <div className="py-2 space-y-3">
      <p className={`text-xs ${muted}`}>{t("settings.toolsRulesHint")}</p>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("settings.toolsRulesSearch")}
        className={`w-full px-3 py-1.5 text-xs rounded border ${
          isDark
            ? "bg-gray-800 border-gray-600 text-gray-200"
            : "bg-white border-gray-300 text-gray-800"
        }`}
      />

      <div className="max-h-72 overflow-y-auto space-y-1">
        {visibleEntries.map((entry) => {
          const risk = riskLabel(entry.risk);
          const fromSettingsOnly =
            !ruleOf(entry.name) && !!settingsRuleOf(entry.name);
          return (
            <div
              key={entry.name}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${rowBg}`}
            >
              <code className="text-xs break-all flex-1">{entry.name}</code>
              {risk && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  {risk}
                </span>
              )}
              {fromSettingsOnly && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-500 dark:text-gray-400"
                  title={t("settings.toolsRulesFromSettingsHint")}
                >
                  {t("settings.toolsRulesFromSettings")}
                </span>
              )}
              <select
                value={behaviorOf(entry.name)}
                disabled={busy === entry.name || fromSettingsOnly}
                onChange={(e) =>
                  void changeBehavior(entry.name, e.target.value as Behavior)
                }
                title={
                  fromSettingsOnly
                    ? t("settings.toolsRulesFromSettingsHint")
                    : undefined
                }
                aria-label={t("settings.toolsRulesBehaviorLabel", {
                  name: entry.name,
                })}
                className={`text-xs rounded border px-1.5 py-0.5 ${
                  isDark
                    ? "bg-gray-800 border-gray-600 text-gray-200"
                    : "bg-white border-gray-300 text-gray-800"
                }`}
              >
                <option value="default">
                  {t("settings.toolsRulesBehaviorDefault")}
                </option>
                <option value="allow">
                  {t("settings.toolsRulesBehaviorAllow")}
                </option>
                <option value="ask">
                  {t("settings.toolsRulesBehaviorAsk")}
                </option>
                <option value="deny">
                  {t("settings.toolsRulesBehaviorDeny")}
                </option>
              </select>
            </div>
          );
        })}
      </div>

      <div className="pt-1">
        <p className={`text-xs font-medium ${muted}`}>
          {t("settings.toolsRulesRemembered", {
            count: fingerprintRules.length,
          })}
        </p>
        <p className={`text-[11px] ${muted}`}>
          {t("settings.toolsRulesRememberedHint")}
        </p>
        {fingerprintRules.length === 0 ? (
          <p className={`text-[11px] py-1 ${muted}`}>
            {t("settings.toolsRulesRememberedEmpty")}
          </p>
        ) : (
          <div className="mt-1 space-y-1">
            {fingerprintRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${rowBg}`}
              >
                <code className="break-all flex-1">
                  {rule.toolName}
                  <span className={`ml-2 ${muted}`}>
                    {rule.inputFingerprint?.slice(0, 12)}
                  </span>
                </code>
                <button
                  type="button"
                  onClick={() => void deleteRule(rule)}
                  disabled={busy === rule.id}
                  className="text-red-400 hover:text-red-600 shrink-0 disabled:opacity-50"
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
