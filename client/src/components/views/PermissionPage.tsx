import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import {
  permissionService,
  type PermissionRule,
} from "../../services/permissionService";
import { handleClientError } from "../../utils/handleError";
import RbacPanel from "./RbacPanel";

function PermissionPage() {
  const { t } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";
  // 2026-11-11：撤销 P3-3 第二步 —— D 体系（细粒度 RBAC）UI 入口重新开放（见 RbacPanel）。
  // 页面结构：上层为 A 体系工具规则（tool_rules.json），下层为 RBAC（roles/users/resources/rules.json）。
  // P1-5：工具权限规则（真实 API /v1/permissions/rules）
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [rulesSummary, setRulesSummary] = useState({
    total: 0,
    allow: 0,
    deny: 0,
    ask: 0,
  });
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleBehavior, setRuleBehavior] = useState<"allow" | "deny" | "ask">(
    "deny",
  );
  const [ruleToolName, setRuleToolName] = useState("");
  const [ruleContentPattern, setRuleContentPattern] = useState("");
  // 影子规则（遮蔽冲突）检测结果
  const [shadowDetection, setShadowDetection] = useState<{
    shadowedCount: number;
    isValid: boolean;
    suggestions: string[];
  } | null>(null);

  useEffect(() => {
    loadConfig();
    loadRules();
  }, [loadConfig]);

  // P1-5：工具权限规则加载/添加/删除
  const loadRules = async () => {
    setRulesLoading(true);
    try {
      const data = await permissionService.listRules();
      setRules(data.rules);
      setRulesSummary(data.summary);
      setShadowDetection(data.shadowDetection ?? null);
    } catch (e) {
      handleClientError(e, { module: "permission:page", action: "loadRules" });
    } finally {
      setRulesLoading(false);
    }
  };

  const addRule = async () => {
    const toolName = ruleToolName.trim();
    if (!toolName) return;
    try {
      await permissionService.addRule(
        ruleBehavior,
        toolName,
        ruleContentPattern.trim() || undefined,
      );
      setRuleToolName("");
      setRuleContentPattern("");
      await loadRules();
    } catch (e) {
      handleClientError(e, { module: "permission:page", action: "addRule" });
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      await permissionService.deleteRule(ruleId);
      await loadRules();
    } catch (e) {
      handleClientError(e, {
        module: "permission:page",
        action: "deleteRule",
      });
    }
  };

  return (
    <div
      className={`flex-1 overflow-y-auto ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-6xl mx-auto p-6">
        {/* P1-5：工具权限规则管理（真实 API /v1/permissions/rules） */}
        <div
          className={`${isDark ? "bg-gray-800" : "bg-white"} rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"} p-6`}
        >
          <div className="flex items-center justify-between mb-2">
            <h3
              className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              {t("permission.toolRules")}
            </h3>
            <button
              onClick={loadRules}
              disabled={rulesLoading}
              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded"
            >
              {rulesLoading ? t("common.loading") : t("common.refresh")}
            </button>
          </div>
          {/* P2-10：与 RuleEngine 对话行为规则区分（rule-handlers.ts 的 /v1/workspaces/:id/rules 是对话规则，与本页工具权限规则无关） */}
          <p
            className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-500"}`}
          >
            {t("permission.toolRulesDesc")}
          </p>

          <div className="flex gap-3 mb-4 text-xs">
            <span className={isDark ? "text-gray-400" : "text-gray-600"}>
              {t("permission.totalCount", {
                count: rulesSummary.total,
              })}
            </span>
            <span className="text-green-600">
              {t("permission.allowCount", {
                count: rulesSummary.allow,
              })}
            </span>
            <span className="text-red-600">
              {t("permission.denyCount", { count: rulesSummary.deny })}
            </span>
            <span className="text-yellow-600">
              {t("permission.askCount", { count: rulesSummary.ask })}
            </span>
          </div>

          {/* 影子规则（遮蔽冲突）检测提示 */}
          {shadowDetection && shadowDetection.shadowedCount > 0 && (
            <div
              className={`mb-4 p-3 rounded-lg text-xs ${
                shadowDetection.isValid
                  ? isDark
                    ? "bg-yellow-900/30 text-yellow-400"
                    : "bg-yellow-50 text-yellow-700"
                  : isDark
                    ? "bg-red-900/30 text-red-400"
                    : "bg-red-50 text-red-700"
              }`}
            >
              <p className="font-medium mb-1">
                {t("permission.ruleConflict", {
                  count: shadowDetection.shadowedCount,
                })}
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {shadowDetection.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2 mb-4">
            <select
              value={ruleBehavior}
              onChange={(e) =>
                setRuleBehavior(e.target.value as "allow" | "deny" | "ask")
              }
              className={`px-2 py-1.5 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-300 text-gray-800"}`}
            >
              <option value="allow">{t("permission.behaviorAllow")}</option>
              <option value="deny">{t("permission.behaviorDeny")}</option>
              <option value="ask">{t("permission.behaviorAsk")}</option>
            </select>
            <input
              placeholder={t("permission.toolNamePlaceholder")}
              value={ruleToolName}
              onChange={(e) => setRuleToolName(e.target.value)}
              className={`flex-1 px-2 py-1.5 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500" : "bg-white border-gray-300 text-gray-800 placeholder-gray-400"}`}
            />
            <input
              placeholder={t("permission.contentPatternPlaceholder")}
              value={ruleContentPattern}
              onChange={(e) => setRuleContentPattern(e.target.value)}
              className={`flex-1 px-2 py-1.5 text-xs rounded border ${isDark ? "bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-500" : "bg-white border-gray-300 text-gray-800 placeholder-gray-400"}`}
            />
            <button
              onClick={addRule}
              disabled={!ruleToolName.trim()}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
            >
              {t("permission.addRule")}
            </button>
          </div>

          {rules.length === 0 ? (
            <p
              className={`text-xs p-3 rounded-lg text-center ${isDark ? "bg-gray-700/50 text-gray-400" : "bg-gray-50 text-gray-500"}`}
            >
              {t("permission.noRulesHint")}
            </p>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                        rule.behavior === "allow"
                          ? isDark
                            ? "bg-green-900/30 text-green-400"
                            : "bg-green-100 text-green-700"
                          : rule.behavior === "deny"
                            ? isDark
                              ? "bg-red-900/30 text-red-400"
                              : "bg-red-100 text-red-700"
                            : isDark
                              ? "bg-yellow-900/30 text-yellow-400"
                              : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {rule.behavior === "allow"
                        ? t("permission.behaviorAllow")
                        : rule.behavior === "deny"
                          ? t("permission.behaviorDeny")
                          : t("permission.behaviorAsk")}
                    </span>
                    <span
                      className={`font-mono text-sm truncate ${isDark ? "text-gray-100" : "text-gray-900"}`}
                    >
                      {rule.toolName}
                    </span>
                    {rule.contentPattern && (
                      <span
                        className={`text-xs font-mono truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {rule.contentPattern}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-xs text-red-500 hover:text-red-400 shrink-0 ml-2"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 细粒度 RBAC：角色 / 用户 / 资源 / 绑定（2026-11-11 重新开放） */}
        <RbacPanel isDark={isDark} />
      </div>
    </div>
  );
}

export default PermissionPage;
