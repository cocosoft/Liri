import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "../../stores/notificationStore";
import { BellIcon, BookOpenIcon, SearchIcon } from "../../assets/icons";
import { APP_EVENTS } from "../../constants/events";

/**
 * 页面顶部 Header
 * 右侧全局快捷入口：全局搜索（⌘K）、帮助中心、消息中心。
 * D-h：仪表盘/用户已降入侧边栏「工作台」（可观测组/个人组）。
 *
 * 2026-10-22（用户反馈「帮助中心没有导航」）：帮助中心此前**只**在工作台「个人」组里，
 * 而该组默认收起 + 侧栏无入口 ⇒ 相当于被藏起来。帮助属**全局工具**（任何页面都可能要用），
 * 按 `frontend.md §4.4`「偏好由设置抽屉承载、全局工具应常驻」的口径，在此常驻一个入口，
 * 工作台里的条目保留（两处指向同一页，不是两套实现）。
 * H7/E-4：全局搜索弹窗与 ⌘K 监听已上提到 App 层（应用级能力），
 *         本组件仅派发 open-global-search 事件。
 * H6/E-5：自动更新轮询已上提到 App 层，不再绑定本组件生命周期。
 */
function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 通知中心
  const openPanel = useNotificationStore((s) => s.openPanel);
  const unreadTotal = useNotificationStore((s) => s.counts.total);

  return (
    <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
      {/* Logo（D-i：Liri 双名——英文 Liri + 中文玲珑鸟） */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="flex items-baseline gap-2 hover:opacity-80 transition-opacity"
        >
          <img
            src="/liri_logo.png"
            alt="Liri Logo"
            className="h-7 w-7 object-contain self-center"
          />
          <h1 className="text-[28px] font-bold leading-none text-gray-900 dark:text-white">
            Liri
          </h1>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {t("header.productZh")}
          </span>
        </button>
      </div>

      {/* 右上：全局搜索 + 消息中心 */}
      <div className="flex items-center gap-1">
        {/* 全局搜索（Ctrl+K / ⌘K，弹窗由 App 层承载） */}
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent(APP_EVENTS.openGlobalSearch))
          }
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title={`${t("common.search")} (Ctrl+K)`}
          aria-label={t("common.search")}
        >
          <SearchIcon size={16} />
          <span className="text-xs hidden md:inline">{t("common.search")}</span>
          <kbd className="hidden md:inline text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600">
            ⌘K
          </kbd>
        </button>

        {/* 帮助中心（全局常驻：任何页面都可能要用） */}
        <button
          onClick={() => navigate("/help")}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title={t("header.helpCenter")}
          aria-label={t("header.helpCenter")}
        >
          <BookOpenIcon size={16} />
        </button>

        {/* 消息中心 */}
        <button
          onClick={openPanel}
          className="relative flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title={t("header.notifications")}
        >
          <BellIcon size={16} />
          {unreadTotal > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

export default Header;
