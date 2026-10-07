/**
 * PatternsTab — 「编排模式」只读清单（PC-6，2026-10-07）
 *
 * 数据源：`GET /v1/patterns`（后端 `listPatternCatalog()` = 模式注册表 + **装配状态** + **触发可达性**）。
 *
 * **为什么需要**：此前 `client/src` 对 `pattern` **0 命中** ⇒ 用户/开发者看不到本应用
 * 有哪些编排模式、哪条线的运行时**已接线**、哪条**未接线**（以及原因）。
 *
 * 呈现原则（如实）：
 * - `unavailable` **不是缺漏**，而是「无运行时 / 无触发场景 / 运行时由别处独立驱动」；
 *   `reachable: false` **也不是缺漏**，而是「选择层无触发规则」
 *   ⇒ 原样展示后端给出的 `reason` / `unreachableReason`（本组件**不**把 technical
 *   文案改写成更"好看"的说法）；
 * - 纯只读（唯一写操作是**显式**「导出快照」按钮，落盘到后端 `reports/`）+ 失败时显示错误，
 *   **不**静默降级为"空清单"。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  patternService,
  type OrchestrationPattern,
} from "../../services/planService";

function PatternCard({ pattern }: { pattern: OrchestrationPattern }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const wired = pattern.status === "ready";
  // 2026-10-07（可达性收口）：徽标三态 —— 已接线·可达 / 已接线·**不可达** / 未接线。
  // 修复前只有二元 `status` ⇒ `self_verify`（接线在、触发永不产出）被谎报为可用。
  const badgeGreen = wired && pattern.reachable;
  const badgeText = !wired
    ? t("chatInspector.patternsUnavailable")
    : pattern.reachable
      ? t("chatInspector.patternsReady")
      : t("chatInspector.patternsWiredUnreachable");

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="text-sm shrink-0 leading-5">
          {badgeGreen ? "✅" : "🚧"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
              {pattern.displayName}
            </span>
            <code className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {pattern.name}
            </code>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                badgeGreen
                  ? "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                  : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
              }`}
            >
              {badgeText}
            </span>
            {wired && pattern.route && (
              <code className="text-[10px] text-gray-400 dark:text-gray-500">
                route: {pattern.route}
              </code>
            )}
          </div>

          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-5">
            <span className="opacity-70">
              {t("chatInspector.patternsWhen")}：
            </span>
            {pattern.when}
          </div>

          {!wired && pattern.reason && (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 leading-5">
              {pattern.reason}
            </div>
          )}

          {!pattern.reachable && pattern.unreachableReason && (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 leading-5">
              {pattern.unreachableReason}
            </div>
          )}

          {pattern.featureGate && (
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-5">
              <span className="opacity-70">
                {t("chatInspector.patternsFeatureGate")}：
              </span>
              <code className="text-[10px]">{pattern.featureGate.flag}</code>
              <span className="ml-1 opacity-70">
                {pattern.featureGate.enabled
                  ? t("chatInspector.patternsGateOn")
                  : t("chatInspector.patternsGateOff")}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            aria-expanded={expanded}
          >
            {t("chatInspector.patternsRoles")}（{pattern.roles.length}）
            {expanded ? " ▾" : " ▸"}
          </button>

          {expanded && (
            <div className="mt-1 space-y-0.5">
              {pattern.bindings.map((b) => (
                <div
                  key={b.role}
                  className="text-[11px] text-gray-500 dark:text-gray-400"
                >
                  <span className="opacity-70">{b.role}</span>
                  <span className="opacity-50"> → </span>
                  <code className="text-[10px]">{b.providers.join(", ")}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PatternsTab() {
  const { t } = useTranslation();
  const [patterns, setPatterns] = useState<OrchestrationPattern[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    patternService
      .list()
      .then((list) => {
        if (alive) setPatterns(list);
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // 2026-10-07：静态目录快照导出（写盘到后端 `~/.pyapp/data/reports/pattern_catalog.json`；
  // 回显**绝对路径**供用户找到文件）。失败如实报错，不静默。
  const onExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await patternService.exportSnapshot();
      setExportMsg({
        kind: "ok",
        text: t("chatInspector.patternsExportOk", {
          count: res.entryCount,
          path: res.path,
        }),
      });
    } catch (e: unknown) {
      setExportMsg({
        kind: "err",
        text: t("chatInspector.patternsExportFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("chatInspector.patternsTitle")}
          </div>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting
              ? t("chatInspector.patternsExporting")
              : t("chatInspector.patternsExport")}
          </button>
        </div>
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 leading-5">
          {t("chatInspector.patternsDesc")}
        </div>
        {exportMsg && (
          <div
            className={`mt-1 text-[11px] break-all leading-5 ${
              exportMsg.kind === "ok"
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {exportMsg.text}
          </div>
        )}
      </div>

      {error ? (
        <div className="p-4 text-sm text-red-600 dark:text-red-400">
          {t("chatInspector.patternsLoadFailed", { error })}
        </div>
      ) : !patterns || patterns.length === 0 ? (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
          {t("chatInspector.patternsEmpty")}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {patterns.map((p) => (
            <PatternCard key={p.name} pattern={p} />
          ))}
        </div>
      )}
    </div>
  );
}

export default PatternsTab;
