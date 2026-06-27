import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import SkillMarketPage from "./SkillMarketPage";
import { useConfigStore } from "../../stores/configStore";

/**
 * 技能市场弹窗组件
 * 将 SkillMarketPage 包装为全屏弹窗，由 SkillPage 触发打开。
 */
function SkillMarketModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { config } = useConfigStore();
  const isDark = config.theme === "dark";

  // 关闭时恢复 body 滚动
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div
        className={`relative flex flex-col flex-1 m-2 md:m-4 rounded-xl overflow-hidden shadow-2xl ${
          isDark ? "bg-gray-900" : "bg-white"
        }`}
      >
        {/* 顶部栏 */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
            isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-50"
          }`}
        >
          <button
            onClick={onClose}
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              isDark
                ? "text-gray-300 hover:text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t("skill.backToManage")}
          </button>
          <h2
            className={`text-base font-semibold ${
              isDark ? "text-gray-100" : "text-gray-900"
            }`}
          >
            {t("skill.title")}
          </h2>
          <div className="w-20" />
        </div>

        {/* 市场页面内容 */}
        <div className="flex-1 overflow-hidden">
          <SkillMarketPage />
        </div>
      </div>
    </div>
  );
}

export default SkillMarketModal;
