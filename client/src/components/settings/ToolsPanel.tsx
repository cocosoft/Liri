// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ToolsPanel — **工具可见性**设置面板（P3，2026-10-16 工具治理）
 *
 * 立项：`dev_docs/20261016/工具可见性治理方案-20261016.md` §3.5（用户已裁定 Q1–Q4）。
 *
 * ## 它解决什么
 * 内置工具"静默消失"有 4 道门（注册 / 可见 / 延迟 / 检索），而此前**用户侧没有任何通路**
 * 既看不见"为什么没了"、也改不动（`GET /v1/tools` 只答"装了什么"）。本面板 = 报表
 * （`GET /v1/tools/visibility`，**只读解释**）+ 三态覆写（`PUT /v1/settings/tools`）。
 *
 * ## 每行必备 4 件（缺一即又成"改了没用的假开关"）
 * 1. 三态控件：跟随任务 / 强制可见 / 强制不可见
 * 2. 实时状态 + **结构化原因**徽标（直接渲染后端 `reasons`，不在前端复算判定）
 * 3. 风险标识：`risk === 'high'` ⇒ 红色 + **二次确认**（文案含"可见不代表放行"）
 * 4. `conditional`（未进生效工具面）行**明确标注**"覆写无效"，且如实归入"不可见"组
 *
 * ## 两条硬边界
 * - **可见性 ≠ 授权**：本层只决定"模型能不能看见"；命令执行 / 文件写入**仍走审批与 PathGuard**
 *   （本面板不发任何授权、不写任何白名单）；
 * - **不给假承诺**：对 `conditional` 工具开启覆写后端**不会**生效 ⇒ 面板显示"已开启但无效"
 *   而非"已开启"。
 *
 * 纯逻辑（分组 / 三态流转 / 二次确认判据 / 原因文案映射）在 `toolsPanelModel.ts`（可单测）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SharedToolVisibilityEntry } from "@shared/types";
import {
  toolService,
  type ToolVisibilityOverrideValue,
  type ToolVisibilityOverrides,
} from "../../services/toolService";
import { ConfigSection } from "./ConfigComponents";
import {
  TOOL_VISIBILITY_REASON_KEYS,
  TOOL_VISIBILITY_REASON_TONES,
  filterEntries,
  groupOf,
  overrideValueOf,
  requiresRiskConfirm,
  summarize,
  withOverride,
  type ToolReasonTone,
  type ToolVisibilityGroupId,
} from "./toolsPanelModel";

export interface ToolsPanelProps {
  isDark: boolean;
}

/** 分组顺序（用户显式选择在前，问题项紧随） */
const GROUP_ORDER: ToolVisibilityGroupId[] = ["on", "default", "hidden", "off"];

const GROUP_TITLE_KEYS: Record<ToolVisibilityGroupId, string> = {
  on: "settings.toolsGroupOn",
  default: "settings.toolsGroupDefault",
  hidden: "settings.toolsGroupHidden",
  off: "settings.toolsGroupOff",
};

const TONE_CLASS: Record<ToolReasonTone, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  neutral: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function ToolsPanel({ isDark }: ToolsPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<SharedToolVisibilityEntry[]>([]);
  const [overrides, setOverrides] = useState<ToolVisibilityOverrides>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  /** 待二次确认的高风险开启请求（方案 §3.5 第 3 件） */
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [report, current] = await Promise.all([
      toolService.visibility(),
      toolService.getVisibilityOverrides(),
    ]);
    // 报表为空 ⇒ 后端不可达 / 未就绪（不臆造数据：CS04/CS06）
    if (report.length === 0) setLoadError(true);
    setEntries(report);
    setOverrides(current);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const commit = useCallback(
    async (name: string, value: ToolVisibilityOverrideValue) => {
      const next = withOverride(overrides, name, value);
      setSaving(true);
      setSaveError(false);
      try {
        await toolService.setVisibilityOverrides(next);
        // BUG-2（2026-10-16 P3 真机复验）：保存后**必须重拉报表** —— `entry.effective` 是
        // **后端**判定的权威结果（本地无法从 overrides 推出"是否真的生效"，`conditional`
        // 情况下 `on` 不生效）。此前只 `setOverrides` ⇒ 分组/徽标按陈旧的 `effective` 渲染，
        // 出现"已开启但无效"的错标，需手动刷新才正确。
        // 落盘是同步内存写（`ConfigManager.setConfigValue`）⇒ 紧接着的读即已是最新。
        const fresh = await toolService.visibility();
        if (fresh.length > 0) setEntries(fresh);
        setOverrides(next);
        setSaved(true);
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    },
    [overrides],
  );

  /** 三态切换入口：高风险工具"新开为可见"先要一次确认 */
  const requestChange = useCallback(
    (entry: SharedToolVisibilityEntry, value: ToolVisibilityOverrideValue) => {
      if (requiresRiskConfirm(entry, value)) {
        setPendingConfirm(entry.name);
        return;
      }
      setPendingConfirm(null);
      void commit(entry.name, value);
    },
    [commit],
  );

  const visibleEntries = useMemo(
    () => filterEntries(entries, query),
    [entries, query],
  );
  const summary = useMemo(
    () => summarize(visibleEntries, overrides),
    [visibleEntries, overrides],
  );
  const grouped = useMemo(() => {
    const buckets: Record<ToolVisibilityGroupId, SharedToolVisibilityEntry[]> =
      {
        on: [],
        default: [],
        hidden: [],
        off: [],
      };
    for (const e of visibleEntries) buckets[groupOf(e, overrides)].push(e);
    return buckets;
  }, [visibleEntries, overrides]);

  const textMuted = isDark ? "text-gray-400" : "text-gray-500";
  const rowBorder = isDark ? "border-gray-800" : "border-gray-100";

  function renderStateButtons(entry: SharedToolVisibilityEntry) {
    const current = overrideValueOf(overrides, entry.name);
    const options: Array<{
      value: ToolVisibilityOverrideValue;
      label: string;
    }> = [
      { value: "auto", label: t("settings.toolsStateAuto") },
      { value: "on", label: t("settings.toolsStateOn") },
      { value: "off", label: t("settings.toolsStateOff") },
    ];
    return (
      <div
        className={`inline-flex rounded border ${rowBorder} overflow-hidden shrink-0`}
      >
        {options.map((opt) => {
          const active = opt.value === current;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              aria-pressed={active}
              onClick={() => requestChange(entry, opt.value)}
              className={`px-2 py-1 text-xs border-r last:border-r-0 ${rowBorder} ${
                active
                  ? "bg-blue-600 text-white"
                  : isDark
                    ? "hover:bg-gray-800 text-gray-300"
                    : "hover:bg-gray-50 text-gray-600"
              } ${saving ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  function renderRow(entry: SharedToolVisibilityEntry) {
    const current = overrideValueOf(overrides, entry.name);
    const visible = entry.effective === "visible";
    // ⚠️ 开启但无效（未进生效工具面）：如实标注，不谎报"已开启"
    const bypassIneffective = current === "on" && !visible;
    return (
      <div
        key={entry.name}
        className={`px-3 py-2 border-b last:border-b-0 ${rowBorder}`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-sm font-medium">{entry.name}</code>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${TONE_CLASS.neutral}`}
              >
                {entry.category}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  visible ? TONE_CLASS.ok : TONE_CLASS.neutral
                }`}
              >
                {visible
                  ? t("settings.toolsStatusVisible")
                  : t("settings.toolsStatusHidden")}
              </span>
              {entry.risk !== "low" && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    entry.risk === "high" ? TONE_CLASS.danger : TONE_CLASS.warn
                  }`}
                >
                  {entry.risk === "high"
                    ? t("settings.toolsRiskHigh")
                    : t("settings.toolsRiskMedium")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {entry.reasons.map((reason) => (
                <span
                  key={reason}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    TONE_CLASS[TOOL_VISIBILITY_REASON_TONES[reason]]
                  }`}
                >
                  {t(TOOL_VISIBILITY_REASON_KEYS[reason])}
                </span>
              ))}
              {bypassIneffective && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${TONE_CLASS.warn}`}
                >
                  {t("settings.toolsOverrideIneffective")}
                </span>
              )}
            </div>
            {entry.registration === "conditional" && (
              <p className={`text-[11px] mt-1 ${textMuted}`}>
                {t("settings.toolsConditionalNote")}
              </p>
            )}
          </div>
          {renderStateButtons(entry)}
        </div>

        {pendingConfirm === entry.name && (
          <div
            className={`mt-2 p-2 rounded border ${rowBorder} ${
              isDark ? "bg-red-900/20" : "bg-red-50"
            }`}
          >
            <p className="text-xs font-medium">
              {t("settings.toolsRiskConfirmTitle", { name: entry.name })}
            </p>
            <p className={`text-[11px] mt-1 ${textMuted}`}>
              {t("settings.toolsRiskConfirmBody")}
            </p>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600"
                onClick={() => setPendingConfirm(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="px-2 py-1 text-xs rounded bg-red-600 text-white"
                onClick={() => {
                  setPendingConfirm(null);
                  void commit(entry.name, "on");
                }}
              >
                {t("settings.toolsRiskConfirmOk")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <ConfigSection
      title={t("settings.tools")}
      description={t("settings.toolsDesc")}
      isDark={isDark}
    >
      <div className="flex items-center gap-2 mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.toolsSearchPlaceholder")}
          aria-label={t("settings.toolsSearchPlaceholder")}
          className={`flex-1 px-2 py-1 text-sm rounded border ${rowBorder} bg-transparent`}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-60"
        >
          {t("settings.refreshStatus")}
        </button>
      </div>

      <p className={`text-[11px] mb-3 ${textMuted}`}>
        {t("settings.toolsSummary", {
          total: summary.total,
          visible: summary.visible,
          forcedOn: summary.forcedOn,
          conditional: summary.conditional,
        })}
      </p>

      {loading && (
        <p className={`text-sm ${textMuted}`}>{t("settings.toolsLoading")}</p>
      )}
      {!loading && loadError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("settings.toolsLoadFailed")}
        </p>
      )}
      {!loading && !loadError && visibleEntries.length === 0 && (
        <p className={`text-sm ${textMuted}`}>{t("settings.toolsEmpty")}</p>
      )}

      {!loading &&
        !loadError &&
        GROUP_ORDER.map((group) => {
          const rows = grouped[group];
          if (rows.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              <h4 className={`text-xs font-semibold mb-1 ${textMuted}`}>
                {t(GROUP_TITLE_KEYS[group])} · {rows.length}
              </h4>
              <div className={`rounded border ${rowBorder}`}>
                {rows.map(renderRow)}
              </div>
            </div>
          );
        })}

      {saveError && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2">
          {t("settings.toolsSaveFailed")}
        </p>
      )}
      {!saveError && saved && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
          {t("settings.toolsSaved")}
        </p>
      )}
    </ConfigSection>
  );
}

export default ToolsPanel;
