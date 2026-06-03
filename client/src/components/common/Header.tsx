import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAutoUpdate } from "../../hooks/useAutoUpdate";

function Header() {
  const navigate = useNavigate();
  const [showHelpMenu, setShowHelpMenu] = useState(false);
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
        setShowHelpMenu(false);
      }
    };
    if (showHelpMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHelpMenu]);

  useEffect(() => {
    startPeriodicCheck(86400000);
    return () => stopPeriodicCheck();
  }, [startPeriodicCheck, stopPeriodicCheck]);

  return (
    <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
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

      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
        >
          <span>📊</span>
          <span>仪表盘</span>
        </button>

        <button
          onClick={() => navigate("/terminal")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
        >
          <span>💻</span>
          <span>终端</span>
        </button>

        <button
          onClick={() => navigate("/apikeys")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
        >
          <span>👤</span>
          <span>用户中心</span>
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowHelpMenu(!showHelpMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm transition-colors"
          >
            <span>❓</span>
            <span>帮助中心</span>
            {result?.available && (
              <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showHelpMenu ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showHelpMenu && (
            <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50">
              <div className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 font-medium border-b border-gray-100 dark:border-gray-700">
                帮助与反馈
              </div>

              {/* 检查更新 */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    软件更新
                  </span>
                  <button
                    onClick={check}
                    disabled={checking || downloading}
                    className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded"
                  >
                    {checking
                      ? "检查中..."
                      : downloading
                        ? "下载中..."
                        : "检查更新"}
                  </button>
                </div>

                {result?.available && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                      发现新版本 {result.latestVersion}
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
                    已是最新版本
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
