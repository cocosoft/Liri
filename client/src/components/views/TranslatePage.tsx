import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";

/**
 * 翻译页面（占位）
 * 后续将实现 AI 多语言翻译、文档翻译等功能
 */
function TranslatePage() {
  const { t } = useTranslation();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  return (
    <div className={`flex flex-col items-center justify-center h-full ${isDark ? "text-gray-400" : "text-gray-500"}`}>
      <svg
        className="w-16 h-16 mb-4 opacity-50"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <h2 className="text-xl font-medium mb-2">{t("translate.title")}</h2>
      <p className="text-sm">{t("translate.comingSoon")}</p>
    </div>
  );
}

export default TranslatePage;
