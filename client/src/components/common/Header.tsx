import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAutoUpdate } from "../../hooks/useAutoUpdate";
import { DashboardIcon, BellIcon, UserIcon, HelpIcon } from "../../assets/icons";

/**
 * 页面顶部 Header
 * 右侧放置全局性快捷入口：仪表盘、用户中心、帮助中心、更新检查
 */
function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showUpdateMenu, setShowUpdateMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    checking,
    downloading,
    result,
    error: updateError,
    check,
    startPeriodicCheck,
    stopPeriodicCheck,
  } = useAutoUpdate();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUpdateMenu(false);
      }
    };
    if (showUpdateMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUpdateMenu]);

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

        {/* 只读显示当前应用名称 */}
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-gray-400 dark:text-gray-500 text-sm select-none">
          {t("header.currentApp")}: Liri
        </span>

        {/* 分隔线 */}
        <span className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1" />

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

        {/* 更新检查 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUpdateMenu(!showUpdateMenu)}
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            title={t("header.checkUpdate")}
          >
            <BellIcon size={16} />
            {result?.available && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>

          {showUpdateMenu && (
            <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50">
              <div className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 font-medium border-b border-gray-100 dark:border-gray-700">
                {t("header.softwareUpdate")}
              </div>

              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("header.checkUpdate")}
                  </span>
                  <button
                    onClick={check}
                    disabled={checking || downloading}
                    className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded"
                  >
                    {checking
                      ? t("header.checking")
                      : downloading
                        ? t("header.downloading")
                        : t("header.checkUpdate")}
                  </button>
                </div>

                {result?.available && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                      {t("header.newVersionFound", { version: result.latestVersion })}
                    </p>
                    {result.body && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 line-clamp-2">
                        {result.body}
                      </p>
                    )}
                  </div>
                )}

                {result && !result.available && !checking && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t("header.upToDate")}
                  </p>
                )}

                {updateError && (
                  <p className="text-xs text-red-500 mt-1">{updateError}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
