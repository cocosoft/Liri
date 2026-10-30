import { useState } from "react";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "./MarkdownRenderer";
import type { DiagnosticBlockData } from "../../types";

/**
 * C4（2026-10-30）：**内部诊断折叠块**。
 *
 * 面向模型的 steering 文案与原始报错（`[系统提示]` / `⚠️ 工具执行失败: Command failed: …` /
 * `安全检查失败: …`）此前原样占据气泡。现在：气泡只显示一行摘要，完整原文收进「诊断详情」，
 * 默认收起、点击展开（复用既有「展开详情 / 收起详情」文案）。
 */
function DiagnosticBlock({ data }: { data: DiagnosticBlockData }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/10">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-start gap-2 px-3 py-2 text-left text-xs text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
      >
        <span className="shrink-0 mt-0.5">&#x26A0;&#xFE0F;</span>
        <span className="flex-1 min-w-0">
          <span className="block truncate" title={data.summary}>
            {data.summary}
          </span>
          <span className="block mt-0.5 text-[11px] text-amber-600/80 dark:text-amber-400/70">
            {t("chat.diagnosticTitle")}
            {" · "}
            {expanded ? t("chat.collapseDetail") : t("chat.expandDetail")}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-amber-900/90 dark:text-amber-200/90 break-words">
          <MarkdownRenderer content={data.detail} />
        </div>
      )}
    </div>
  );
}

export default DiagnosticBlock;
