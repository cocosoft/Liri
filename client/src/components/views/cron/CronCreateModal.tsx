/**
 * 新建定时任务弹窗（CronPage 拆分批 1，2026-11-18）
 *
 * 表单状态仍由父组件持有（提交与重置在父组件完成），本组件只负责渲染与受控更新。
 * 表单契约与初值见 `./cronForm`（单一真源）。
 */
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduleMode } from "../../../types";
import { cronTemplates } from "../../../config/cronTemplates";
import type { CronFormState } from "./cronForm";

interface Props {
  form: CronFormState;
  setForm: Dispatch<SetStateAction<CronFormState>>;
  submitting: boolean;
  /** 点遮罩关闭（拆分前语义：只关闭，**不**重置表单） */
  onClose: () => void;
  /** 点「取消」（拆分前语义：关闭 **并** 重置表单） */
  onCancel: () => void;
  onSubmit: () => void;
}

export default function CronCreateModal({
  form,
  setForm,
  submitting,
  onClose,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();

  /** 构建调度表达式的可读预览 */
  const buildSchedulePreview = (): string => {
    if (form.scheduleMode === "cron") {
      const expr = form.expression.trim();
      return expr || "—";
    }
    if (form.scheduleMode === "every") {
      const unitLabel =
        form.everyUnit === "minutes"
          ? t("cron.minutesUnit")
          : form.everyUnit === "hours"
            ? t("cron.hoursUnit")
            : t("cron.daysUnit");
      return t("cron.everyNTemplate", {
        value: form.everyValue,
        unit: unitLabel,
      });
    }
    // at mode
    return t("cron.atTimeTemplate", {
      hour: form.atHour,
      minute: form.atMinute,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            {t("cron.newTask", "新建定时任务")}
          </h3>

          {/* 快速模板预设 */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t("cron.templates", "快速模板")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {cronTemplates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({
                      ...prev,
                      scheduleMode: tmpl.scheduleMode,
                      expression: tmpl.cronExpr ?? prev.expression,
                      everyValue: tmpl.everyValue ?? prev.everyValue,
                      everyUnit: tmpl.everyUnit ?? prev.everyUnit,
                      atHour: tmpl.atHour ?? prev.atHour,
                      atMinute: tmpl.atMinute ?? prev.atMinute,
                      silent: tmpl.silent ?? false,
                    }));
                  }}
                  className="px-3 py-2 text-left text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 transition-colors"
                >
                  <div className="font-medium text-gray-800 dark:text-gray-200">
                    {t(tmpl.labelKey)}
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    {t(tmpl.descriptionKey)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("cron.taskName", "任务名称")} *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder={t("cron.taskNamePlaceholder", "Enter task name")}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400"
              />
            </div>

            {/* 执行内容 (prompt) - 定时任务要执行的具体指令 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("cron.promptLabel", "Execution Content")} *
              </label>
              <textarea
                value={form.prompt}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, prompt: e.target.value }))
                }
                placeholder={t(
                  "cron.promptPlaceholder",
                  'What should this job do? e.g. "Check system health and report status"',
                )}
                rows={3}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
              />
            </div>

            {/* 调度模式选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t("cron.scheduleMode", "Schedule Mode")}
              </label>
              <div className="flex gap-2">
                {(
                  [
                    {
                      value: "cron",
                      label: t("cron.scheduleCron", "Cron Expression"),
                    },
                    {
                      value: "every",
                      label: t("cron.scheduleEvery", "Interval"),
                    },
                    { value: "at", label: t("cron.scheduleAt", "At Time") },
                  ] as { value: ScheduleMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        scheduleMode: opt.value,
                      }))
                    }
                    className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                      form.scheduleMode === opt.value
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-700 dark:text-blue-400 font-medium"
                        : "bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cron 模式：文本输入 */}
            {form.scheduleMode === "cron" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("cron.expression", "Cron Expression")}
                </label>
                <input
                  type="text"
                  value={form.expression}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      expression: e.target.value,
                    }))
                  }
                  placeholder={t("cron.cronPlaceholder", "e.g. 0 8 * * *")}
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {t("cron.cronFormat", "Format: min hour day month weekday")}
                </p>
              </div>
            )}

            {/* Every 模式：数值 + 单位 */}
            {form.scheduleMode === "every" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("cron.intervalLabel", "Interval")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={form.everyValue}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        everyValue: Math.max(1, parseInt(e.target.value) || 1),
                      }))
                    }
                    className="w-24 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                  />
                  <select
                    value={form.everyUnit}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        everyUnit: e.target.value as
                          "minutes" | "hours" | "days",
                      }))
                    }
                    className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                  >
                    <option value="minutes">
                      {t("cron.minutesUnit", "Minutes")}
                    </option>
                    <option value="hours">
                      {t("cron.hoursUnit", "Hours")}
                    </option>
                    <option value="days">{t("cron.daysUnit", "Days")}</option>
                  </select>
                </div>
              </div>
            )}

            {/* At 模式：时:分 */}
            {form.scheduleMode === "at" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("cron.atTimeLabel", "Time (Daily)")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={form.atHour}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        atHour: e.target.value.padStart(2, "0"),
                      }))
                    }
                    className="w-20 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    placeholder={t("cron.hourPlaceholder")}
                  />
                  <span className="text-gray-500 dark:text-gray-400 font-bold">
                    :
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={form.atMinute}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        atMinute: e.target.value.padStart(2, "0"),
                      }))
                    }
                    className="w-20 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                    placeholder={t("cron.minutePlaceholder")}
                  />
                </div>
              </div>
            )}

            {/* 人类可读预览 */}
            <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
              <span className="text-xs text-blue-500 dark:text-blue-400 font-medium">
                {t("cron.previewLabel", "Preview")}:{" "}
              </span>
              <span className="text-sm text-blue-700 dark:text-blue-300 font-mono">
                {buildSchedulePreview()}
              </span>
            </div>

            {/* 静默开关 */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("cron.silent", "Silent Mode")}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("cron.silentDesc", "Skip notification on completion")}
                </p>
              </div>
              <button
                onClick={() =>
                  setForm((prev) => ({ ...prev, silent: !prev.silent }))
                }
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  form.silent ? "bg-purple-500" : "bg-gray-300 dark:bg-gray-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    form.silent ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* 投递配置 */}
            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("cron.deliveryConfig", "Delivery Config")}
              </label>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={form.deliver || "local"}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      deliver: e.target.value,
                    }))
                  }
                  className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100"
                >
                  <option value="local">
                    {t("cron.deliverLocal", "Local")}
                  </option>
                  <option value="announce">
                    {t("cron.deliverAnnounce", "Announce")}
                  </option>
                  <option value="webhook">
                    {t("cron.deliverWebhook", "Webhook")}
                  </option>
                </select>
                {(form.deliver === "announce" ||
                  form.deliver === "webhook") && (
                  <input
                    type="text"
                    value={form.deliverTo || ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        deliverTo: e.target.value,
                      }))
                    }
                    placeholder={t(
                      "cron.deliverToPlaceholder",
                      "Channel or URL",
                    )}
                    className="flex-1 px-2 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("cron.description", "Description")}
              </label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder={t(
                  "cron.descriptionPlaceholder",
                  "Enter description (optional)",
                )}
                rows={3}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cron-enabled"
                checked={form.enabled}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, enabled: e.target.checked }))
                }
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label
                htmlFor="cron-enabled"
                className="text-sm text-gray-700 dark:text-gray-300"
              >
                {t("cron.createAndEnable", "Create and enable")}
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              onClick={onSubmit}
              disabled={
                !form.name.trim() ||
                (form.scheduleMode === "cron" && !form.expression.trim()) ||
                submitting
              }
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? t("cron.creating", "Creating...")
                : t("cron.create", "Create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
