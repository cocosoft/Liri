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
 *
 * R3/R5（2026-11-17）消费的后端治理字段（均来自同一份列表/健康视图，**不做前端推算**）：
 * - `hitCount` / `lastHitAt`：决策链真实命中计数（0 ⇒ 显示「尚未命中」，不编造）；
 * - `approvalRules` + `approvalPause`：审批生成放行分组与「暂停全部持久化放行」开关；
 * - `unknownCommandSuggestions`：近 N 天被转审批的未收录命令（无样本 ⇒ 不显示）；
 * - 写接口 409 `error.code='impact'`：影响预演阻断 ⇒ **二次确认**后带 `confirmImpact` 重试；
 * - `GET /rules/health` 的 `ruleHits`：观察期未满（`observationComplete=false`）时
 *   **不得**展示「未命中」结论。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SharedToolVisibilityEntry } from "@shared/types";
import { toolService } from "../../services/toolService";
import {
  permissionService,
  readRuleWriteFailure,
  type AllowBudget,
  type ApprovalPauseState,
  type CommandRulesView,
  type PermissionRule,
  type PermissionRulesHealth,
  type RuleImpactPreview,
  type UnknownCommandSuggestions,
} from "../../services/permissionService";
import { handleClientError } from "../../utils/handleError";

type Behavior = "default" | "allow" | "ask" | "deny";

interface Props {
  isDark: boolean;
}

/** 影响预演阻断后的待确认动作（409 未写任何状态 ⇒ 重试即重新提交同一意图） */
interface PendingImpact {
  message: string;
  impact: RuleImpactPreview;
  retry: () => Promise<void>;
}

/** 未收录命令 → 新增命令规则的表单草稿 */
interface RuleDraft {
  behavior: "allow" | "ask" | "deny";
  toolName: string;
  contentPattern: string;
}

/** 工具级规则（整工具生效；指纹/内容规则不在此列；只读的 settings 规则也不在此列） */
function isToolLevelRule(rule: PermissionRule): boolean {
  return !rule.readOnly && !rule.inputFingerprint && !rule.contentPattern;
}

export default function ToolRulesSection({ isDark }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SharedToolVisibilityEntry[]>([]);
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [approvalPause, setApprovalPause] = useState<ApprovalPauseState | null>(
    null,
  );
  const [approvalRules, setApprovalRules] = useState<PermissionRule[]>([]);
  const [unknownSuggestions, setUnknownSuggestions] =
    useState<UnknownCommandSuggestions | null>(null);
  /** R2b：用户手建 allow 规则用量（超限时写接口 409，前端提前提示） */
  const [allowBudget, setAllowBudget] = useState<AllowBudget | null>(null);
  /** R1.5：B 体系命令级策略只读视图（未配置 ⇒ null） */
  const [bCommandRules, setBCommandRules] = useState<CommandRulesView | null>(
    null,
  );
  const [health, setHealth] = useState<PermissionRulesHealth | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [pendingImpact, setPendingImpact] = useState<PendingImpact | null>(
    null,
  );
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
    setApprovalPause(nextRules.approvalPause ?? null);
    setApprovalRules(nextRules.approvalRules?.rules ?? []);
    setUnknownSuggestions(nextRules.unknownCommandSuggestions ?? null);
    setAllowBudget(nextRules.allowBudget ?? null);
    setBCommandRules(nextRules.commandRules ?? null);
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
  /**
   * P1（2026-11-07）：**命令级免审批**规则（工具 + 命令前缀，`contentPattern`）。
   *
   * 这些规则由审批卡「以后这个命令免审批」写入（`persistAllowlistRule(commandLevel=true)`）。
   * 此前本面板只列"整工具"与"同参数指纹"两类，`contentPattern` 规则**既不展示也无法撤销**
   * ⇒ 用户在审批卡上点下的命令级放行，到设置里找不到（与卡片上的"可撤销"承诺不符）。
   */
  const commandRules = useMemo(
    () => rules.filter((r) => !!r.contentPattern),
    [rules],
  );
  /** settings 文件来源（只读合并视图）：展示真实生效值，但不在本面板写入 */
  const settingsRules = useMemo(
    () =>
      rules.filter(
        (r) =>
          r.readOnly &&
          r.origin !== "approval" &&
          !r.inputFingerprint &&
          !r.contentPattern,
      ),
    [rules],
  );
  /**
   * R3：「本工作区永久信任」类审批放行（`workspaceRoot`，无指纹/无内容模式）。
   *
   * 此前它们被 `settingsRules` 的 `readOnly` 条件误收成「来自 settings」——
   * 实际来源是审批卡，且可撤销，故单独成组。
   */
  const workspaceTrustRules = useMemo(
    () =>
      rules.filter(
        (r) =>
          r.origin === "approval" && !r.inputFingerprint && !r.contentPattern,
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

  /** 工具级规则的实际写入（不含 busy 守卫，供首次提交与二次确认复用） */
  const performBehaviorChange = async (
    name: string,
    next: Behavior,
    confirmImpact: boolean,
  ) => {
    const existing = ruleOf(name);
    if (existing && next === "default") {
      await permissionService.deleteRule(existing.id);
    } else if (existing && existing.behavior !== next) {
      // R2：编辑走单次原子 PUT（旧做法"先删后加"在 409 影响阻断时会留下半完成状态）
      await permissionService.updateRule(existing.id, {
        behavior: next as "allow" | "deny" | "ask",
        ...(confirmImpact ? { confirmImpact: true } : {}),
      });
    } else if (!existing && next !== "default") {
      await permissionService.addRule(
        next,
        name,
        undefined,
        confirmImpact ? { confirmImpact: true } : undefined,
      );
    }
  };

  const changeBehavior = async (name: string, next: Behavior) => {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      await performBehaviorChange(name, next, false);
      await reload();
    } catch (e) {
      const failure = readRuleWriteFailure(e);
      if (failure?.impact?.degraded) {
        setPendingImpact({
          message: failure.message,
          impact: failure.impact,
          retry: () => retryBehaviorChange(name, next),
        });
      } else {
        handleClientError(e, {
          module: "components:settings:ToolRules",
          action: "changeBehavior",
        });
        setError(failure?.message ?? t("settings.toolsRulesSaveFailed"));
      }
    } finally {
      setBusy(null);
    }
  };

  /**
   * 影响预演二次确认后的重试。
   *
   * 单独入口而非复用 `changeBehavior`：后者的闭包捕获了上一次渲染的 `busy`
   * （此时为工具名）⇒ 复用会被 `if (busy) return` 直接挡掉，表现为"确认按钮没反应"。
   */
  const retryBehaviorChange = async (name: string, next: Behavior) => {
    setBusy(name);
    setError(null);
    try {
      await performBehaviorChange(name, next, true);
      await reload();
    } catch (e) {
      const failure = readRuleWriteFailure(e);
      handleClientError(e, {
        module: "components:settings:ToolRules",
        action: "retryBehaviorChange",
      });
      setError(failure?.message ?? t("settings.toolsRulesSaveFailed"));
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

  /** R3：一键暂停 / 恢复全部持久化放行 */
  const toggleApprovalPause = async () => {
    if (!approvalPause || busy) return;
    setBusy("approvalPause");
    setError(null);
    try {
      await permissionService.setApprovalPause(!approvalPause.enabled);
      await reload();
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:ToolRules",
        action: "toggleApprovalPause",
      });
      setError(t("settings.toolsRulesSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  /** 保存「未收录命令 → 新增规则」表单；409 影响预演 ⇒ 二次确认 */
  const saveDraft = async (confirmImpact = false) => {
    if (!draft) return;
    const toolName = draft.toolName.trim();
    if (!toolName) return;
    setBusy("draft");
    setError(null);
    try {
      await permissionService.addRule(
        draft.behavior,
        toolName,
        draft.contentPattern.trim() || undefined,
        confirmImpact ? { confirmImpact: true } : undefined,
      );
      setDraft(null);
      setPendingImpact(null);
      await reload();
    } catch (e) {
      const failure = readRuleWriteFailure(e);
      if (failure?.impact?.degraded && !confirmImpact) {
        setPendingImpact({
          message: failure.message,
          impact: failure.impact,
          retry: () => saveDraft(true),
        });
      } else {
        handleClientError(e, {
          module: "components:settings:ToolRules",
          action: "saveDraft",
        });
        setError(failure?.message ?? t("settings.toolsRulesSaveFailed"));
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmPendingImpact = async () => {
    const pending = pendingImpact;
    if (!pending) return;
    setPendingImpact(null);
    await pending.retry();
  };

  /** R0/R5：规则文件健康 + 命中统计（按需拉取，避免每次进 tab 多打一个只读接口） */
  const checkHealth = async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    setError(null);
    try {
      setHealth(await permissionService.getRulesHealth());
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:ToolRules",
        action: "checkHealth",
      });
      setError(t("settings.toolsRulesLoadFailed"));
    } finally {
      setHealthBusy(false);
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
  const inputBg = isDark
    ? "bg-gray-800 border-gray-600 text-gray-200"
    : "bg-white border-gray-300 text-gray-800";

  const riskLabel = (risk: string): string | null => {
    if (risk === "high") return t("settings.toolsRiskHigh");
    if (risk === "medium") return t("settings.toolsRiskMedium");
    if (risk === "unknown") return t("settings.toolsRiskUnknown");
    return null;
  };

  /**
   * R5：命中统计徽标。
   *
   * `hitCount` 缺省（settings 来源）⇒ 不渲染（不显示假 0）；
   * `0` ⇒ 「尚未命中」；`>0` ⇒ 次数 + 最近命中时间（tooltip）。
   */
  const hitBadge = (rule: PermissionRule | undefined) => {
    if (!rule || rule.hitCount === undefined) return null;
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

      {/* R2b：allow 预算用量（后端超限即 409，这里提前把额度说清楚） */}
      {allowBudget && (
        <>
          <p
            className={`text-[11px] ${
              allowBudget.used >= allowBudget.limit
                ? "text-amber-600 dark:text-amber-400"
                : muted
            }`}
          >
            {t("settings.toolsRulesAllowBudget", {
              used: allowBudget.used,
              limit: allowBudget.limit,
            })}
          </p>
          {allowBudget.used >= allowBudget.limit && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {t("settings.toolsRulesAllowBudgetHint")}
            </p>
          )}
        </>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* R5：近 N 天被转审批的未收录命令（后端无样本 ⇒ null，此处不渲染） */}
      {unknownSuggestions && unknownSuggestions.headCount > 0 && (
        <div
          className={`rounded-lg p-3 space-y-1 ${
            isDark ? "bg-amber-500/10" : "bg-amber-50"
          }`}
        >
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("settings.toolsRulesUnknownTitle", {
              days: unknownSuggestions.sinceDays,
              headCount: unknownSuggestions.headCount,
              sampleCount: unknownSuggestions.sampleCount,
            })}
          </p>
          <p className={`text-[11px] ${muted}`}>
            {t("settings.toolsRulesUnknownHint")}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {unknownSuggestions.topHeads.map((entry) => (
              <button
                key={entry.head}
                type="button"
                title={entry.latestSurface}
                onClick={() =>
                  setDraft({
                    // 未收录命令的语义就是「每次都要问」；默认给 allow 才是减少审批的本意，
                    // 但保存前表单可见可改（deny/ask 都允许）
                    behavior: "allow",
                    toolName: "",
                    contentPattern: entry.head,
                  })
                }
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
      )}

      {/* 影响预演阻断（409 impact）：确认后才带 confirmImpact=true 重试 */}
      {pendingImpact && (
        <div
          className={`rounded-lg p-3 space-y-1 border ${
            isDark
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-amber-400 bg-amber-50"
          }`}
        >
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("settings.toolsRulesImpactTitle", {
              count: pendingImpact.impact.degradedCommands.length,
            })}
          </p>
          <ul className={`text-[11px] list-disc pl-4 ${muted}`}>
            {pendingImpact.impact.degradedCommands.map((command) => (
              <li key={command}>
                <code>{command}</code>
              </li>
            ))}
          </ul>
          <p className={`text-[11px] ${muted}`}>{pendingImpact.message}</p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void confirmPendingImpact()}
              disabled={busy !== null}
              className="px-2 py-0.5 text-[11px] rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
            >
              {t("settings.toolsRulesImpactConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setPendingImpact(null)}
              className={`px-2 py-0.5 text-[11px] rounded border ${inputBg}`}
            >
              {t("settings.toolsRulesImpactCancel")}
            </button>
          </div>
        </div>
      )}

      {/* 未收录命令点「去添加规则」后展开；工具名需用户填（后端样本只记命令原文，不猜方言） */}
      {draft && (
        <div className={`rounded-lg p-3 space-y-2 ${rowBg}`}>
          <p className={`text-xs font-medium ${muted}`}>
            {t("settings.toolsRulesAddTitle")}
          </p>
          <div className="flex gap-2">
            <select
              value={draft.behavior}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  behavior: e.target.value as RuleDraft["behavior"],
                })
              }
              className={`px-1.5 py-0.5 text-xs rounded border ${inputBg}`}
              aria-label={t("settings.toolsRulesAddTitle")}
            >
              <option value="allow">
                {t("settings.toolsRulesBehaviorAllow")}
              </option>
              <option value="ask">{t("settings.toolsRulesBehaviorAsk")}</option>
              <option value="deny">
                {t("settings.toolsRulesBehaviorDeny")}
              </option>
            </select>
            <input
              value={draft.toolName}
              onChange={(e) => setDraft({ ...draft, toolName: e.target.value })}
              placeholder={t("permission.toolNamePlaceholder")}
              className={`flex-1 px-2 py-1 text-xs rounded border ${inputBg}`}
            />
            <input
              value={draft.contentPattern}
              onChange={(e) =>
                setDraft({ ...draft, contentPattern: e.target.value })
              }
              placeholder={t("permission.contentPatternPlaceholder")}
              className={`flex-1 px-2 py-1 text-xs rounded border ${inputBg}`}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={busy !== null || !draft.toolName.trim()}
              className="px-2 py-0.5 text-[11px] rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {t("settings.toolsRulesAddSave")}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={`px-2 py-0.5 text-[11px] rounded border ${inputBg}`}
            >
              {t("settings.toolsRulesAddCancel")}
            </button>
          </div>
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("settings.toolsRulesSearch")}
        className={`w-full px-3 py-1.5 text-xs rounded border ${inputBg}`}
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
              {hitBadge(ruleOf(entry.name))}
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
                className={`text-xs rounded border px-1.5 py-0.5 ${inputBg}`}
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

      {/* R3：审批放行总开关（作用范围=审批生成的规则；仍可逐条撤销） */}
      <div className={`flex items-center gap-2 rounded px-3 py-1.5 ${rowBg}`}>
        <label className="flex items-center gap-2 text-xs flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={approvalPause?.enabled ?? false}
            disabled={!approvalPause || busy !== null}
            onChange={() => void toggleApprovalPause()}
          />
          <span>{t("settings.toolsRulesPauseLabel")}</span>
          {approvalPause?.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
              {t("settings.toolsRulesPauseEnabled")}
            </span>
          )}
        </label>
        <span className={`text-[10px] ${muted}`}>
          {t("settings.toolsRulesApprovals", { count: approvalRules.length })}
        </span>
      </div>
      <p className={`text-[11px] ${muted}`}>
        {t("settings.toolsRulesPauseHint")}
      </p>

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
                {hitBadge(rule)}
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
      {/* P1（2026-11-07）：命令级免审批（审批卡「以后这个命令免审批」写入，可撤销） */}
      <div className="pt-1">
        <p className={`text-xs font-medium ${muted}`}>
          {t("settings.toolsRulesCommands", { count: commandRules.length })}
        </p>
        <p className={`text-[11px] ${muted}`}>
          {t("settings.toolsRulesCommandsHint")}
        </p>
        {commandRules.length === 0 ? (
          <p className={`text-[11px] py-1 ${muted}`}>
            {t("settings.toolsRulesCommandsEmpty")}
          </p>
        ) : (
          <div className="mt-1 space-y-1">
            {commandRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${rowBg}`}
              >
                <code className="break-all flex-1">
                  {rule.toolName}
                  <span className={`ml-2 ${muted}`}>{rule.contentPattern}</span>
                </code>
                {hitBadge(rule)}
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

      {/* R3：本工作区永久信任（审批生成，只读可撤销；此前被误标成「来自 settings」） */}
      <div className="pt-1">
        <p className={`text-xs font-medium ${muted}`}>
          {t("settings.toolsRulesWorkspaceTrust", {
            count: workspaceTrustRules.length,
          })}
        </p>
        <p className={`text-[11px] ${muted}`}>
          {t("settings.toolsRulesApprovalsHint")}
        </p>
        {workspaceTrustRules.length === 0 ? (
          <p className={`text-[11px] py-1 ${muted}`}>
            {t("settings.toolsRulesApprovalsEmpty")}
          </p>
        ) : (
          <div className="mt-1 space-y-1">
            {workspaceTrustRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${rowBg}`}
              >
                <code className="break-all flex-1">{rule.toolName}</code>
                {rule.workspaceRoot && (
                  <span className={`text-[10px] truncate ${muted}`}>
                    {rule.workspaceRoot}
                  </span>
                )}
                {hitBadge(rule)}
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

      {/* R1.5：B 体系命令级策略（只读；它在 bash / powershell 判定链直接生效，
          只展示 tool_rules.json 会让用户误以为"没配规则"） */}
      {bCommandRules && (
        <div className="pt-1">
          <p className={`text-xs font-medium ${muted}`}>
            {t("settings.toolsRulesBCommandRules", {
              mode:
                bCommandRules.mode === "whitelist"
                  ? t("settings.toolsRulesBCommandModeWhitelist")
                  : t("settings.toolsRulesBCommandModeBlacklist"),
            })}
          </p>
          <p className={`text-[11px] ${muted}`}>
            {t("settings.toolsRulesBCommandRulesHint")}
          </p>
          {bCommandRules.blacklist.length === 0 &&
          bCommandRules.whitelist.length === 0 ? (
            <p className={`text-[11px] py-1 ${muted}`}>
              {t("settings.toolsRulesBCommandRulesEmpty")}
            </p>
          ) : (
            <div className="mt-1 space-y-1">
              {bCommandRules.blacklist.length > 0 && (
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${rowBg}`}
                >
                  <span className={`shrink-0 ${muted}`}>
                    {t("settings.rulesTabCommandBlacklist")}
                  </span>
                  <code className="break-all flex-1">
                    {bCommandRules.blacklist
                      .map((rule) => rule.pattern)
                      .join(" · ")}
                  </code>
                </div>
              )}
              {bCommandRules.whitelist.length > 0 && (
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${rowBg}`}
                >
                  <span className={`shrink-0 ${muted}`}>
                    {t("settings.rulesTabCommandWhitelist")}
                  </span>
                  <code className="break-all flex-1">
                    {bCommandRules.whitelist
                      .map((rule) => rule.pattern)
                      .join(" · ")}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* R0/R5：规则文件健康 + 命中统计（按需触发；观察期未满不判定「未命中」） */}
      <div className="pt-1 space-y-1">
        <button
          type="button"
          onClick={() => void checkHealth()}
          disabled={healthBusy}
          className={`px-2 py-0.5 text-[11px] rounded border ${inputBg} disabled:opacity-50`}
        >
          {healthBusy
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
    </div>
  );
}
