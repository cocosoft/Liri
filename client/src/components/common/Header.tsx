import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAutoUpdate } from "../../hooks/useAutoUpdate";
import { useConfigStore } from "../../stores/configStore";
import { useNotificationStore } from "../../stores/notificationStore";
import {
  DashboardIcon,
  BellIcon,
  UserIcon,
  HelpIcon,
  SearchIcon,
} from "../../assets/icons";
import GlobalSearchModal from "../ChatArea/GlobalSearchModal";

/**
 * 页面顶部 Header
 * 右侧放置全局性快捷入口：仪表盘、用户中心、帮助中心、消息通知
 */
function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDark = useConfigStore((s) => s.config.theme === "dark");
  const [searchOpen, setSearchOpen] = useState(false);
  const { startPeriodicCheck, stopPeriodicCheck } = useAutoUpdate();

  // 通知中心
  const openPanel = useNotificationStore((s) => s.openPanel);
  const unreadTotal = useNotificationStore((s) => s.counts.total);

  /** Ctrl+K / Cmd+K 唤起全局搜索 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleOpenSearch = useCallback(() => setSearchOpen(true), []);
  const handleCloseSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    startPeriodicCheck(86400000);
    return () => stopPeriodicCheck();
  }, [startPeriodicCheck, stopPeriodicCheck]);

  return (
    <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <img
            src="/liri_logo.png"
            alt="Liri Logo"
            className="h-7 w-7 object-contain"
          />
          <h1 className="text-[32px] font-bold text-gray-900 dark:text-white">
            Liri
          </h1>
        </button>
      </div>

      {/* 右上：全局快捷入口 */}
      <div className="flex items-center gap-1">
        {/* 仪表盘 */}
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
          title={t("nav.dashboard")}
        >
          <DashboardIcon size={16} />
          <span>{t("nav.dashboard")}</span>
        </button>

        {/* 分隔线 */}
        <span className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" />

        {/* 全局搜索（Ctrl+K / ⌘K） */}
        <button
          onClick={handleOpenSearch}
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

        {/* 用户中心 */}
        <button
          onClick={() => navigate("/user")}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title={t("header.userCenter")}
        >
          <UserIcon size={18} />
        </button>

        {/* 帮助中心 */}
        <button
          onClick={() => navigate("/help")}
          className="flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title={t("header.helpCenter")}
        >
          <HelpIcon size={18} />
        </button>

        {/* 消息中心 */}
        <button
          onClick={openPanel}
          className="relative flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
          title="消息中心"
        >
          <BellIcon size={16} />
          {unreadTotal > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
        </button>
      </div>

      {/* 全局搜索弹窗（应用级，所有页面可用） */}
      <GlobalSearchModal
        isOpen={searchOpen}
        onClose={handleCloseSearch}
        isDark={isDark}
      />
    </header>
  );
}

export default Header;
