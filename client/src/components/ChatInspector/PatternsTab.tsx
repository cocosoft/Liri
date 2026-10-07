/**
 * PatternsTab — 「编排模式」只读清单（PC-6，2026-10-07）
 *
 * 数据源：`GET /v1/patterns`（后端 `listPatternCatalog()` = 模式注册表 + **装配状态**）。
 *
 * **为什么需要**：此前 `client/src` 对 `pattern` **0 命中** ⇒ 用户/开发者看不到本应用
 * 有哪些编排模式、哪条线的运行时**已接线**、哪条**未接线**（以及原因）。
 *
 * 呈现原则（如实）：
 * - `unavailable` **不是缺漏**，而是「无运行时 / 无触发场景 / 运行时由别处独立驱动」
 *   ⇒ 原样展示后端给出的 `reason`（本组件**不**把 technical 文案改写成更"好看"的说法）；
 * - 纯只读，无任何写操作；失败时显示错误，**不**静默降级为"空清单"。
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
  const ready = pattern.status === "ready";

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="text-sm shrink-0 leading-5">
          {ready ? "✅" : "🚧"}
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
                ready
                  ? "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                  : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
              }`}
            >
              {ready
                ? t("chatInspector.patternsReady")
                : t("chatInspector.patternsUnavailable")}
            </span>
            {ready && pattern.route && (
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

          {!ready && pattern.reason && (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 leading-5">
              {pattern.reason}
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

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t("chatInspector.patternsTitle")}
        </div>
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 leading-5">
          {t("chatInspector.patternsDesc")}
        </div>
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
