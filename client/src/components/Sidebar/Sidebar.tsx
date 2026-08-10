import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNavigationStore } from "../../stores/navigationStore";
import type { AppPage } from "../../stores/navigationStore";
import { useConfigStore } from "../../stores/configStore";
import { useNotificationStore } from "../../stores/notificationStore";
import {
  HomeIcon,
  DashboardIcon,
  ChatIcon,
  KnowledgeIcon,
  ImageIcon,
  TranslateIcon,
  ModelIcon,
  SkillIcon,
  FileIcon,
  McpIcon,
  ChannelIcon,
  PluginIcon,
  ThemeIcon,
  SettingsIcon,
  CouncilIcon,
  OfficeIcon,
  CalendarIcon,
  BellIcon,
  TaskIcon,
} from "../../assets/icons";

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  path?: string;
  action?: () => void;
}

const HIGH_FREQUENCY_ITEMS: MenuItem[] = [
  { id: "home", label: "首页", icon: HomeIcon, path: "/" },
  { id: "chat", label: "聊天", icon: ChatIcon, path: "/chat" },
  { id: "projects", label: "项目", icon: DashboardIcon, path: "/projects" },
  { id: "calendar", label: "日历", icon: CalendarIcon, path: "/calendar" },
  { id: "office", label: "办公", icon: OfficeIcon, path: "/office" },
  { id: "media", label: "媒体", icon: ImageIcon, path: "/media" },
  { id: "translate", label: "翻译", icon: TranslateIcon, path: "/translate" },
  { id: "knowledge", label: "知识库", icon: KnowledgeIcon, path: "/knowledge" },
];

/** 菜单项 id 到 i18n key 的映射 */
const MENU_LABEL_KEYS: Record<string, string> = {
  projects: "nav.projects",
  home: "nav.home",
  chat: "nav.chat",
  calendar: "nav.calendar",
  office: "office.title",
  translate: "translate.title",
  knowledge: "knowledge.title",
  models: "model.title",
  skills: "skill.title",
  files: "nav.files",
  mcp: "mcp.title",
  plugins: "pluginMarket.title",
  channels: "channels.title",
  "council-roles": "agent.title",
  "background-status": "nav.backgroundStatus",
  theme: "settings.theme",
  settings: "nav.settings",
};

/** 管理折叠：模型/技能/MCP/频道/文件 */
const MANAGEMENT_ITEMS: MenuItem[] = [
  { id: "models", label: "模型", icon: ModelIcon, path: "/models" },
  { id: "skills", label: "技能", icon: SkillIcon, path: "/skills" },
  { id: "files", label: "文件", icon: FileIcon, path: "/files" },
  { id: "mcp", label: "MCP", icon: McpIcon, path: "/market/mcp" },
  { id: "plugins", label: "插件", icon: PluginIcon, path: "/market/plugins" },
  { id: "channels", label: "频道", icon: ChannelIcon, path: "/channels" },
  {
    id: "council-roles",
    label: "理事会",
    icon: CouncilIcon,
    path: "/agent/roles",
  },
  // 后台任务运行状况（§9.3 P3：Dream 记忆整理 + Buddy 成长执行状态）
  {
    id: "background-status",
    label: "后台任务",
    icon: TaskIcon,
    path: "/background-status",
  },
];

const SYSTEM_ITEMS: MenuItem[] = [
  { id: "theme", label: "主题", icon: ThemeIcon },
  { id: "settings", label: "设置", icon: SettingsIcon, path: "/settings" },
];

function MenuButton({
  item,
  isActive,
  onNavigate,
}: {
  item: MenuItem;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const isDark = config.theme === "dark";

  const labelText = t(MENU_LABEL_KEYS[item.id] || item.label);

  const handleClick = () => {
    const actualPath = item.path;
    if (actualPath) {
      if (actualPath === "/") {
        setActivePage("home");
      } else {
        const pageId = actualPath.replace("/", "") || "chat";
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
    >
      <IconComponent size={20} />
      <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
        {labelText}
      </span>
    </button>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const activeRoute = location.pathname.replace("/", "") || "home";
  const [showManagement, setShowManagement] = useState(false);

  /** 判断当前路由是否匹配菜单项 */
  const isActive = (item: MenuItem) => {
    const normalizedPath = (item.path || "").replace("/", "") || "home";
    return (
      activeRoute === normalizedPath ||
      activeRoute.startsWith(normalizedPath + "/")
    );
  };

  return (
    <aside className="w-20 bg-gray-100 dark:bg-gray-900 flex flex-col h-full">
      {/* 高频导航 */}
      <div className="flex-1 overflow-y-auto p-1">
        <div className="space-y-0.5">
          {HIGH_FREQUENCY_ITEMS.map((item) => (
            <MenuButton
              key={item.id}
              item={item}
              isActive={isActive(item)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>

      {/* 管理折叠按钮 */}
      <div className="p-1 border-t border-gray-300 dark:border-gray-700">
        <button
          onClick={() => setShowManagement(!showManagement)}
          className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
            showManagement || MANAGEMENT_ITEMS.some((m) => isActive(m))
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
          title={t("sidebar.manage")}
        >
          <SettingsIcon size={20} />
          <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
            {t("sidebar.manage")}
          </span>
        </button>

        {/* 展开的管理项 */}
        {showManagement && (
          <div className="mt-0.5 space-y-0.5">
            {MANAGEMENT_ITEMS.map((item) => (
              <MenuButton
                key={item.id}
                item={item}
                isActive={isActive(item)}
                onNavigate={onNavigate}
              />
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

  type MItem = {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string; size?: number }>;
    path?: string;
    onClick?: () => void;
    badge?: number;
  };

  const items: MItem[] = [
    { id: "projects", label: "项目", icon: HomeIcon, path: "/projects" },
    { id: "chat", label: "对话", icon: ChatIcon, path: "/chat" },
    {
      id: "notifications",
      label: "通知",
      icon: BellIcon,
      onClick: openPanel,
      badge: unreadTotal,
    },
    {
      id: "settings",
      label: t("nav.settings"),
      icon: SettingsIcon,
      path: "/settings",
    },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-around py-1 z-50 safe-area-bottom">
      {items.map((item) => {
        const isActive =
          activeRoute === (item.path?.replace("/", "") || "home");
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
  );
}

export default Sidebar;
export { MobileBottomNav };
