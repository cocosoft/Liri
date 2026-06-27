import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";

/**
 * 视频处理页面（占位）
 * 后续将实现 AI 视频生成、编辑等功能
 */
function VideoPage() {
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
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
      <h2 className="text-xl font-medium mb-2">{t("video.title")}</h2>
      <p className="text-sm">{t("video.comingSoon")}</p>
    </div>
  );
}

export default VideoPage;
