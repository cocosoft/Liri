/**
 * 快速模板条（CronPage 拆分批 1，2026-11-18）
 *
 * 点击任一模板 ⇒ 由父组件打开新建弹窗并套用该模板（本组件不持有状态）。
 */
import { useTranslation } from "react-i18next";
import type { ScheduleMode } from "../../../types";

/** 模板形状（父组件 `applyTemplate` 的入参） */
export interface CronQuickTemplate {
  labelKey: string;
  scheduleMode: ScheduleMode;
  cronExpr?: string;
  everyValue?: number;
  everyUnit?: "minutes" | "hours" | "days";
  atHour?: string;
  atMinute?: string;
}

const TEMPLATES: CronQuickTemplate[] = [
  {
    labelKey: "cron.quickTemplate30min",
    scheduleMode: "every",
    everyValue: 30,
    everyUnit: "minutes",
  },
  {
    labelKey: "cron.quickTemplate1h",
    scheduleMode: "every",
    everyValue: 1,
    everyUnit: "hours",
  },
  {
    labelKey: "cron.quickTemplate6h",
    scheduleMode: "every",
    everyValue: 6,
    everyUnit: "hours",
  },
  {
    labelKey: "cron.quickTemplate8am",
    scheduleMode: "cron",
    cronExpr: "0 8 * * *",
  },
  {
    labelKey: "cron.quickTemplate14pm",
    scheduleMode: "at",
    atHour: "14",
    atMinute: "00",
  },
  {
    labelKey: "cron.quickTemplate9am",
    scheduleMode: "at",
    atHour: "9",
    atMinute: "00",
  },
  {
    labelKey: "cron.quickTemplateMon9am",
    scheduleMode: "cron",
    cronExpr: "0 9 * * 1",
  },
];

interface Props {
  onApply: (template: CronQuickTemplate) => void;
}

export default function CronQuickTemplates({ onApply }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
        {t("cron.quickTemplateTitle", "Quick Templates (click to apply)")}
      </p>
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.labelKey}
            onClick={() => onApply(template)}
            className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-400 rounded-full transition-colors border border-gray-200 dark:border-gray-600"
          >
            {t(template.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
