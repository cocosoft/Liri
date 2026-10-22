/**
 * 会话洞察面板（2026-10-23，方案 B）
 *
 * 数据来自后端 `insights report` 命令的结构化 `data`（统计 / 摘要 / 决策 / 待决问题 /
 * 涉及文件 / 建议），前端**只负责展示**，不复制提取逻辑（实现唯一性）。
 * 后端未返回结构化载荷时回退为纯文本 `output`，保证旧后端也能用。
 */
import { useTranslation } from "react-i18next";

/** 与后端 `InsightReport`（app/src/commands/builtin/insights/Insights.ts）逐一对应 */
export interface SessionInsightsReport {
  sessionId: string;
  stats: {
    totalMessages: number;
    byRole: { user: number; assistant: number; system: number; tool: number };
    firstAt?: string;
    lastAt?: string;
    spanMinutes?: number;
  };
  summary: string;
  keyFacts: string[];
  decisions: string[];
  pendingQuestions: string[];
  fileChanges: string[];
  suggestions: Array<{
    type: string;
    message: string;
    priority: "high" | "medium" | "low";
  }>;
  extractedAt: number;
}

interface SessionInsightsModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  report: SessionInsightsReport | null;
  /** 纯文本回退（后端 `output`；结构化载荷缺失时使用） */
  text: string;
  onClose: () => void;
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-3">
      <h4 className="text-xs font-medium text-gray-700 dark:text-gray-200">
        {title}（{items.length}）
      </h4>
      <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportBody({ report }: { report: SessionInsightsReport }) {
  const { t } = useTranslation();
  const { stats } = report;

  if (stats.totalMessages === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t("chat.insightsNoMessages")}
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("chat.insightsStats", {
          total: stats.totalMessages,
          user: stats.byRole.user,
          assistant: stats.byRole.assistant,
          tool: stats.byRole.tool,
          system: stats.byRole.system,
        })}
      </p>
      {stats.firstAt && stats.lastAt && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("chat.insightsSpan", {
            range: `${new Date(stats.firstAt).toLocaleString()} ~ ${new Date(
              stats.lastAt,
            ).toLocaleString()}`,
            minutes: stats.spanMinutes ?? 0,
          })}
        </p>
      )}

      {report.summary && (
        <section className="mt-3">
          <h4 className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {t("chat.insightsSummary")}
          </h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {report.summary}
          </p>
        </section>
      )}

      <Section title={t("chat.insightsKeyFacts")} items={report.keyFacts} />
      <Section title={t("chat.insightsDecisions")} items={report.decisions} />
      <Section
        title={t("chat.insightsPending")}
        items={report.pendingQuestions}
      />
      <Section title={t("chat.insightsFiles")} items={report.fileChanges} />
      <Section
        title={t("chat.insightsSuggestions")}
        items={report.suggestions.map(
          (item) => `[${item.priority.toUpperCase()}] ${item.message}`,
        )}
      />
    </div>
  );
}

export default function SessionInsightsModal({
  open,
  loading,
  error,
  report,
  text,
  onClose,
}: SessionInsightsModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("chat.insightsTitle")}
        className="max-h-[70vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {t("chat.insightsTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-100"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("chat.insightsLoading")}
          </p>
        ) : error ? (
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : report ? (
          <ReportBody report={report} />
        ) : (
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700 dark:text-gray-200">
            {text}
          </pre>
        )}

        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          {t("chat.insightsHint")}
        </p>
      </div>
    </div>
  );
}
