import { useState, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useNavigationStore } from "../../stores/navigationStore";
import type { AppPage } from "../../stores/navigationStore";
import { useConfigStore } from "../../stores/configStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useRootStore } from "../../stores/root-store";
import { selectEnabledModules } from "../../stores/selectors";
import { DashboardIcon, ThemeIcon, SettingsIcon } from "../../assets/icons";
import { PreviewBadge } from "../common/PreviewBadge";
import CreateProjectModal from "../Workspace/CreateProjectModal";
import { useSettingsPanelStore } from "../../stores/settingsPanelStore";
// §4.3-6：导航元数据单一事实来源（高区/工作台/底栏条目均由此派生，门控在派生函数内部完成）
import {
  highFrequencyNavEntries,
  mobileNavEntries,
  toEnabledModuleIds,
  workbenchGroups,
} from "../../config/navRegistry";

interface MenuItem {
  id: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  path?: string;
  /** i18n key：展示文案唯一来源（§4.3-6 起不再保留 label 兜底字符串） */
  labelKey?: string;
  /** 未完全成熟的新能力：true 时渲染 Preview 角标 */
  preview?: boolean;
  /** 自定义点击行为：存在时优先于默认 path 跳转（如 A5 项目 flyout toggle） */
  onClickOverride?: () => void;
}

/**
 * §4.3-11（2026-09-20）：账户菜单直达项。
 * 文案复用与导航 / 首页卡片一致的功能名称（满足"一个功能一个名称"清单）。
 */
const ACCOUNT_MENU_ITEMS: Array<{
  id: string;
  labelKey: string;
  path: string;
}> = [
  { id: "memory", labelKey: "nav.accountMemory", path: "/memory" },
  { id: "usage", labelKey: "nav.accountUsage", path: "/usage" },
  { id: "cron", labelKey: "nav.accountCron", path: "/cron" },
  { id: "settings", labelKey: "nav.accountSettings", path: "/settings" },
  { id: "profile", labelKey: "nav.accountProfile", path: "/user" },
];

/** 系统项（无独立导航注册表条目）id → i18n key 的映射 */
const MENU_LABEL_KEYS: Record<string, string> = {
  theme: "settings.theme",
  settings: "nav.settings",
};

const SYSTEM_ITEMS: MenuItem[] = [
  { id: "theme", icon: ThemeIcon },
  {
    id: "settings",
    icon: SettingsIcon,
    path: "/settings",
    // A3：设置改为侧边抽屉打开（保留 path 供 /settings 页高亮）
    onClickOverride: () => useSettingsPanelStore.getState().openPanel(),
  },
];

function MenuButton({
  item,
  isActive,
  onNavigate,
  onClickOverride,
}: {
  item: MenuItem;
  isActive: boolean;
  onNavigate?: () => void;
  onClickOverride?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const isDark = config.theme === "dark";

  const labelText = t(item.labelKey ?? MENU_LABEL_KEYS[item.id]);

  const handleClick = () => {
    // A5：自定义点击行为（如项目 flyout toggle）优先于默认 path 跳转
    if (onClickOverride) {
      onClickOverride();
      return;
    }
    const actualPath = item.path;
    if (actualPath) {
      if (actualPath === "/") {
        setActivePage("home");
      } else {
        const pageId = actualPath.split("?")[0].replace("/", "") || "chat";
        setActivePage(pageId as AppPage);
      }
      navigate(actualPath);
      onNavigate?.();
    } else if (item.id === "theme") {
      const newTheme = isDark ? "light" : "dark";
      setConfig("theme", newTheme);
    }
  };

  if (item.id === "theme") {
    return (
      <button
        onClick={handleClick}
        className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
          isDark
            ? "text-yellow-400 hover:bg-gray-700"
            : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        }`}
        title={isDark ? t("sidebar.switchToLight") : t("sidebar.switchToDark")}
      >
        <ThemeIcon size={20} />
        <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
          {isDark ? t("settings.light") : t("settings.dark")}
        </span>
      </button>
    );
  }

  const IconComponent = item.icon;

  return (
    <button
      onClick={handleClick}
      className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
        isActive
          ? "bg-blue-600 text-white"
          : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
      }`}
      title={labelText}
      // §4.3-7 可访问性基线：当前项标记（此前全仓无 aria-current）
      aria-current={isActive ? "page" : undefined}
    >
      <IconComponent size={20} />
      <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center gap-1">
        {labelText}
        {item.preview && <PreviewBadge />}
      </span>
    </button>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute = location.pathname.replace("/", "") || "home";
  const [showManagement, setShowManagement] = useState(false);
  // A5：项目浮动子面板 + 新建项目弹窗
  const [showProjectsFlyout, setShowProjectsFlyout] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // N-23（2026-09-20）：项目浮动面板此前只有"点遮罩 / 点选项目"两种关闭途径，
  // 键盘用户缺少退出路径 ⇒ 补 Escape 关闭（与 SettingsPanel 等浮层行为一致）。
  useEffect(() => {
    if (!showProjectsFlyout) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowProjectsFlyout(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showProjectsFlyout]);
  // §4.3-11（2026-09-20）：账户菜单（底部头像 → 浮动直达入口，对齐 Copilot 账户菜单）
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const { config: appConfig } = useConfigStore();
  const accountName = (
    (appConfig.user as { displayName?: string } | undefined)?.displayName ?? ""
  ).trim();
  const accountInitial = accountName.charAt(0).toUpperCase() || "U";
  // ESC 关闭（与项目 flyout 的 N-23 同款处理）
  useEffect(() => {
    if (!showAccountMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAccountMenu(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAccountMenu]);
  const worktrees = useRootStore((s) => s.worktrees);

  // P2-10 / §4.3-6：高区与工作台条目来自 navRegistry，模块门控集合由 selectEnabledModules 派生
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const enabledModuleIds = useMemo(
    () => toEnabledModuleIds(enabledModules),
    [enabledModules],
  );
  const highFrequencyItems = useMemo<MenuItem[]>(() => {
    return highFrequencyNavEntries(enabledModuleIds).map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey,
      icon: entry.icon,
      path: entry.path,
      preview: entry.preview,
      // A5：项目项点击切换浮动子面板，不直接跳转 /projects
      onClickOverride:
        entry.id === "projects"
          ? () => setShowProjectsFlyout((v) => !v)
          : undefined,
    }));
  }, [enabledModuleIds]);

  /** 工作台四组（唯一来源 navRegistry；aside 折叠区与移动端抽屉共用） */
  const wbGroups = useMemo(
    () => workbenchGroups(enabledModuleIds),
    [enabledModuleIds],
  );

  // A5：项目 flyout 列表——仅用户创建项目，按名称排序（与 ProjectsPage 同源过滤）
  const userProjects = useMemo(
    () =>
      Object.values(worktrees)
        .filter((w) => w.workspaceSource === "user")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [worktrees],
  );

  /**
   * 判断当前路由是否匹配菜单项（忽略 query string）。
   *
   * N-22（2026-09-20）**统一 active 语义**：
   * - **页面型项**（有 `path`）：精确匹配或子路径匹配（`/tasks/:id` 归属 `/tasks`）；
   * - **动作型项**（无 `path`，如打开面板/抽屉/弹窗）**不参与** active 判定 ——
   *   此前 `(item.path || "") ... || "home"` 的回退会让它们在首页（`/`）**误高亮**。
   */
  const isActive = (item: MenuItem) => {
    if (!item.path) return false;
    const normalizedPath = item.path.split("?")[0].replace("/", "") || "home";
    return (
      activeRoute === normalizedPath ||
      activeRoute.startsWith(normalizedPath + "/")
    );
  };

  /**
   * N-22：工作台开关按钮的 active（与 `aria-current` **共用同一判定**，此前二者不一致：
   * 高亮存在但无 `aria-current`）。其"目标范围" = 目录页本身（`/workbench`）
   * 或其展开态，或其任一子项页。
   */
  const isWorkbenchActive =
    showManagement ||
    activeRoute === "workbench" ||
    wbGroups.some((g) => g.items.some((m) => isActive(m)));

  return (
    <aside className="relative w-20 bg-gray-100 dark:bg-gray-900 flex flex-col h-full">
      {/* 4.1-2：品牌 Logo 作为首页入口（对齐 Copilot 品牌按钮） */}
      <button
        onClick={() => navigate("/")}
        title="Liri"
        className="flex items-center justify-center h-12 shrink-0 text-blue-600 dark:text-blue-400 font-bold text-sm tracking-tight hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
      >
        Liri
      </button>
      {/* 高频导航 */}
      <div className="flex-1 overflow-y-auto p-1">
        <div className="space-y-0.5">
          {highFrequencyItems.map((item) => (
            <MenuButton
              key={item.id}
              item={item}
              isActive={isActive(item)}
              onNavigate={onNavigate}
              onClickOverride={item.onClickOverride}
            />
          ))}
        </div>
      </div>

      {/* A5：项目浮动子面板（对齐 Copilot Projects 折叠二级导航） */}
      {showProjectsFlyout && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowProjectsFlyout(false)}
          />
          <div className="absolute left-full top-0 ml-1 z-50 w-60 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[70vh]">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              {t("nav.projects")}
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {userProjects.length > 0 ? (
                userProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      navigate(`/projects/${p.id}?open=${p.id}`);
                      setShowProjectsFlyout(false);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 truncate"
                    title={p.name}
                  >
                    {p.name}
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                  {t("sidebar.noProjects")}
                </div>
              )}
            </div>
            <div className="p-1 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowCreateModal(true)}
                className="w-full text-left px-2 py-1.5 rounded text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700"
              >
                + {t("sidebar.newProject")}
              </button>
            </div>
          </div>
        </>
      )}
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => {
            setShowCreateModal(false);
            setShowProjectsFlyout(false);
          }}
        />
      )}

      {/* 工作台折叠按钮 */}
      <div className="p-1 border-t border-gray-300 dark:border-gray-700">
        <button
          onClick={() => setShowManagement(!showManagement)}
          aria-current={isWorkbenchActive ? "page" : undefined}
          className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
            isWorkbenchActive
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
          title={t("sidebar.workbench")}
        >
          <DashboardIcon size={20} />
          <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
            {t("sidebar.workbench")}
          </span>
        </button>

        {/* 展开的工作台：四组（自主任务/平台治理/可观测/个人） */}
        {showManagement && (
          <div className="mt-0.5 max-h-[55vh] overflow-y-auto">
            {wbGroups.map((group) => (
              <div key={group.id} className="mt-1.5">
                <div className="px-1 py-0.5 text-[10px] text-gray-400 dark:text-gray-500 text-center truncate">
                  {t(group.labelKey)}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <MenuButton
                      key={item.id}
                      item={item}
                      isActive={isActive(item)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 系统导航 */}
      <div className="p-1 border-t border-gray-300 dark:border-gray-700">
        <div className="space-y-0.5">
          {SYSTEM_ITEMS.map((item) => (
            <MenuButton
              key={item.id}
              item={item}
              isActive={isActive(item)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>

      {/* §4.3-11（2026-09-20）：账户入口（底部头像按钮） */}
      <div className="p-1 border-t border-gray-300 dark:border-gray-700">
        <button
          onClick={() => setShowAccountMenu((v) => !v)}
          aria-expanded={showAccountMenu}
          aria-haspopup="menu"
          title={t("nav.account")}
          className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
            showAccountMenu
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          <span className="w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500 text-white text-xs flex items-center justify-center">
            {accountInitial}
          </span>
          <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
            {t("nav.account")}
          </span>
        </button>
      </div>

      {/* §4.3-11：账户浮动菜单（复用 A5 项目 flyout 的"遮罩 + left-full 定位"模式） */}
      {showAccountMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowAccountMenu(false)}
          />
          <div
            role="menu"
            className="absolute left-full bottom-0 ml-1 z-50 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 truncate">
              {accountName || t("nav.accountLocalUser")}
            </div>
            <div className="p-1">
              {ACCOUNT_MENU_ITEMS.map((item) => (
                <button
                  key={item.id}
                  role="menuitem"
                  onClick={() => {
                    navigate(item.path);
                    setShowAccountMenu(false);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

/** 移动端：底部导航栏 */
function MobileBottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute = location.pathname.replace("/", "") || "home";
  const openPanel = useNotificationStore((s) => s.openPanel);
  const unreadTotal = useNotificationStore((s) => s.counts.total);
  // H5 修复：移动端侧栏被 hidden lg:block 隐藏，工作台四组原无任何入口
  // （D-h 把 /dashboard /user /help 从 Header 移入工作台后，这三项在移动端彻底不可达）
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  // §4.3-6：与 aside 折叠区共用同一份 navRegistry 数据与门控集合
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const enabledModuleIds = useMemo(
    () => toEnabledModuleIds(enabledModules),
    [enabledModules],
  );
  /** 工作台四组（唯一来源 navRegistry，与 aside 折叠区共用同一数据） */
  const wbGroups = useMemo(
    () => workbenchGroups(enabledModuleIds),
    [enabledModuleIds],
  );

  type MItem = {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string; size?: number }>;
    path?: string;
    onClick?: () => void;
    badge?: number;
  };

  // §4.3-6：底栏条目来自 navRegistry；动作型条目在此映射到具体行为
  const items: MItem[] = mobileNavEntries(enabledModuleIds).map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey),
    icon: entry.icon,
    path: entry.path,
    badge:
      entry.badge === "unread" && unreadTotal > 0 ? unreadTotal : undefined,
    onClick: entry.action
      ? {
          openNotifications: openPanel,
          openWorkbench: () => setWorkbenchOpen(true),
          openSettings: () => useSettingsPanelStore.getState().openPanel(),
        }[entry.action]
      : undefined,
  }));

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-around py-1 z-50 safe-area-bottom">
        {items.map((item) => {
          // N-22（2026-09-20）统一 active 语义：
          // ① 动作型项（无 `path`，打开面板/抽屉）**不参与** active 判定 ——
          //    此前 `item.path?.replace(...) || "home"` 会让它们在首页误高亮；
          // ② 页面型项补子路径匹配（与桌面 `isActive` 一致，如 `/tasks/:id` 归属 `/tasks`）。
          const normalizedPath = item.path?.replace("/", "") || "";
          const isActive =
            !!normalizedPath &&
            (activeRoute === normalizedPath ||
              activeRoute.startsWith(normalizedPath + "/"));
          const IconComponent = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.onClick) {
                  item.onClick();
                } else {
                  navigate(item.path!);
                }
              }}
              className={`relative flex flex-col items-center px-2 py-1 min-w-0 ${
                isActive ? "text-blue-600" : "text-gray-500 dark:text-gray-400"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <IconComponent size={18} />
              {item.id === "notifications" && unreadTotal > 0 && (
                <span className="absolute -top-0.5 right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1 leading-none">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              )}
              <span className="text-xs mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* H5 修复：移动端工作台抽屉（遮罩 + 底部面板，复用 navRegistry 工作台四组） */}
      {workbenchOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[60] bg-black/40"
          onClick={() => setWorkbenchOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("sidebar.workbench")}
            className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t("sidebar.workbench")}
              </span>
              <button
                onClick={() => setWorkbenchOpen(false)}
                aria-label={t("common.close")}
                className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400"
              >
                ✕
              </button>
            </div>
            {wbGroups.map((group) => (
              <div key={group.id} className="mb-3">
                <div className="mb-1 text-xs text-gray-400 dark:text-gray-500">
                  {t(group.labelKey)}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {group.items.map((item) => {
                    const IconComponent = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          if (item.path) navigate(item.path);
                          setWorkbenchOpen(false);
                        }}
                        className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 px-1 py-2 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <IconComponent size={18} />
                        <span className="w-full truncate text-center text-xs flex items-center justify-center gap-1">
                          {t(item.labelKey)}
                          {item.preview && <PreviewBadge />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
export { MobileBottomNav };
