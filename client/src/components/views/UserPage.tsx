import { useState, lazy, Suspense, useEffect, useCallback } from "react";
import { useConfigStore } from "../../stores/configStore";
import { httpLegacy as http } from "../../services/httpClient";

/** 用户中心侧边栏导航项 */
interface UserNavItem {
  id: string;
  label: string;
  icon: string;
}

/** 懒加载子页面注册表 */
const SUB_PAGE_REGISTRY: Record<string, React.LazyExoticComponent<React.FC>> = {
  apikeys: lazy(() => import("./ApiKeyPage")),
  oauth: lazy(() => import("./OAuthPage")),
  permissions: lazy(() => import("./PermissionPage")),
};

const NAV_ITEMS: UserNavItem[] = [
  { id: "profile", label: "个人资料", icon: "U" },
  { id: "apikeys", label: "API 密钥", icon: "K" },
  { id: "oauth", label: "OAuth 应用", icon: "O" },
  { id: "permissions", label: "权限管理", icon: "P" },
];

const ACTIVE_NAV_KEY = "liri-user-active-nav";

/** 通用时区列表 */
const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Seoul",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Auckland",
  "Australia/Sydney",
  "UTC",
];

interface UserConfig {
  displayName?: string;
  timezone?: string;
}

function UserPage() {
  const { config, setConfig } = useConfigStore();
  const userCfg = config.user as UserConfig | undefined;
  const [activeNav, setActiveNav] = useState(() => {
    try {
      const s = localStorage.getItem(ACTIVE_NAV_KEY);
      if (s && NAV_ITEMS.some((n) => n.id === s)) return s;
    } catch { /* ignore */ }
    return "profile";
  });
  const [appInfo, setAppInfo] = useState<{
    version: string;
    dataDir: string;
    pyappHome: string;
  } | null>(null);
  const [nickname, setNickname] = useState(
    () => String(userCfg?.displayName ?? "")
  );
  const [nickSaved, setNickSaved] = useState(false);
  const isDark = config.theme === "dark";

  useEffect(() => {
    http
      .get<{ version: string; dataDir: string; pyappHome: string }>(
        "/v1/app/info"
      )
      .then((r: any) => {
        if (r?.ok) setAppInfo(r.data);
      })
      .catch(() => {});
  }, []);

  const switchNav = (id: string) => {
    setActiveNav(id);
    try {
      localStorage.setItem(ACTIVE_NAV_KEY, id);
    } catch { /* ignore */ }
  };

  /** 保存昵称 */
  const saveNickname = useCallback(() => {
    setConfig("user", { ...((config.user as object) || {}), displayName: nickname });
    setNickSaved(true);
    setTimeout(() => setNickSaved(false), 2000);
  }, [nickname, config.user, setConfig]);

  /** 获取头像首字母 */
  const avatarInitial = nickname
    ? nickname.charAt(0).toUpperCase()
    : "U";

  return (
    <div className="flex flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-900">
      {/* ── 左侧导航 ── */}
      <aside className="w-52 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            用户中心
          </h2>
        </div>
        <nav className="pb-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => switchNav(item.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium border-r-2 border-blue-500"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <span className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800">
        {activeNav === "profile" ? renderProfile() : renderLazyPage()}
      </main>
    </div>
  );

  /** 个人资料 */
  function renderProfile() {
    const info = appInfo;
    return (
      <div className="p-6 max-w-2xl space-y-8">
        {/* ── 个人资料 ── */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            个人资料
          </h3>
          <div className="space-y-5">
            {/* 头像 */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold select-none">
                {avatarInitial}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {nickname || "本地用户"}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  本地账户 · 无需登录
                </p>
                {info && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    v{info.version}
                  </p>
                )}
              </div>
            </div>

            {/* 昵称 */}
            <div>
              <label
                htmlFor="nickname-input"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
              >
                显示名称
              </label>
              <div className="flex gap-2 items-start">
                <input
                  id="nickname-input"
                  type="text"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setNickSaved(false);
                  }}
                  placeholder="请输入显示名称"
                  maxLength={30}
                  className="flex-1 max-w-xs px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={saveNickname}
                  className={`px-4 py-2 text-sm rounded transition-colors ${
                    nickSaved
                      ? "bg-green-500 text-white"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  {nickSaved ? "已保存" : "保存"}
                </button>
              </div>
            </div>

            {/* 主题偏好 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                主题偏好
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfig("theme", "light")}
                  className={`px-4 py-2 text-sm rounded border transition-colors ${
                    !isDark
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600"
                      : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  浅色
                </button>
                <button
                  onClick={() => setConfig("theme", "dark")}
                  className={`px-4 py-2 text-sm rounded border transition-colors ${
                    isDark
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600"
                      : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  深色
                </button>
              </div>
            </div>

            {/* 界面语言 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                界面语言
              </label>
              <select
                value={String(config.locale ?? "zh-CN")}
                onChange={(e) => setConfig("locale", e.target.value)}
                className="w-full max-w-xs px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </div>

            {/* 时区 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                时区
              </label>
              <select
                value={String(userCfg?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}
                onChange={(e) =>
                  setConfig("user", {
                    ...((config.user as object) || {}),
                    timezone: e.target.value,
                  })
                }
                className="w-full max-w-xs px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── 系统信息 ── */}
        {info && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              系统信息
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                <span className="text-gray-600 dark:text-gray-400">
                  应用版本
                </span>
                <span className="text-gray-900 dark:text-gray-100 font-mono">
                  {info.version}
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                <span className="text-gray-600 dark:text-gray-400">
                  数据目录
                </span>
                <span
                  className="text-gray-900 dark:text-gray-100 font-mono text-xs truncate max-w-[240px] text-right"
                  title={info.dataDir}
                >
                  {info.dataDir}
                </span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded">
                <span className="text-gray-600 dark:text-gray-400">
                  用户目录
                </span>
                <span
                  className="text-gray-900 dark:text-gray-100 font-mono text-xs truncate max-w-[240px] text-right"
                  title={info.pyappHome}
                >
                  {info.pyappHome}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /** 懒加载子页面（含回退） */
  function renderLazyPage() {
    const LazyComp = SUB_PAGE_REGISTRY[activeNav];
    if (!LazyComp)
      return <div className="p-6 text-gray-500">页面加载中...</div>;
    return (
      <Suspense fallback={<div className="p-6 text-gray-500">加载中...</div>}>
        <LazyComp />
      </Suspense>
    );
  }
}

export default UserPage;
