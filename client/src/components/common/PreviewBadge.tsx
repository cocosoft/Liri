import { useTranslation } from "react-i18next";

/**
 * Preview 角标：标记未完全成熟的新能力（对齐 Copilot Tasks/Health Preview）。
 * 导航项元数据 preview: true 时由各渲染点引用。
 */
export function PreviewBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[9px] font-medium leading-none bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 ${
        className ?? ""
      }`}
    >
      {t("common.preview")}
    </span>
  );
}
