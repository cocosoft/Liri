import { useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useNavigationStore } from "../../stores/navigationStore";
import type { AppPage } from "../../stores/navigationStore";
import { useConfigStore } from "../../stores/configStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useRootStore } from "../../stores/root-store";
import { selectEnabledModules } from "../../stores/selectors";
import {
  HomeIcon,
  DashboardIcon,
  ChatIcon,
  KnowledgeIcon,
  ImageIcon,
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
  TaskIcon,
  BellIcon,
  UsersIcon,
  CronIcon,
  ZapIcon,
  CloudIcon,
  KeyIcon,
  ShieldIcon,
  DollarIcon,
  DocIcon,
  DatabaseIcon,
  DevIcon,
  BookOpenIcon,
  BuddyIcon,
  WaveformIcon,
  LinkIcon,
  SlidersIcon,
  MicIcon,
} from "../../assets/icons";

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  path?: string;
  action?: () => void;
  /** i18n key；优先于 label 硬编码 */
  labelKey?: string;
}

/**
 * 高区导航元信息（P2-10：注册表驱动）。
 * order 决定展示顺序；moduleId 存在时表示该项由模块注册表（selectEnabledModules）
 * 派生——模块被禁用/tier 不可见时该项自动隐藏；无 moduleId 的项（首页/任务）常驻。
 */
const HIGH_FREQ_NAV: Array<{
  id: string;
  moduleId?: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  labelKey: string;
  path: string;
  order: number;
}> = [
  { id: "home", icon: HomeIcon, labelKey: "nav.home", path: "/", order: 10 },
  {
    id: "chat",
    moduleId: "chat",
    icon: ChatIcon,
    labelKey: "nav.chat",
    path: "/chat",
    order: 20,
  },
  {
    id: "projects",
    moduleId: "project",
    icon: DashboardIcon,
    labelKey: "nav.projects",
    path: "/projects",
    order: 30,
  },
  {
    id: "tasks",
    icon: TaskIcon,
    labelKey: "nav.tasks",
    path: "/tasks",
    order: 40,
  },
  {
    id: "office",
    moduleId: "office",
    icon: OfficeIcon,
    labelKey: "nav.office",
    path: "/office",
    order: 50,
  },
  {
    id: "media",
    moduleId: "media",
    icon: ImageIcon,
    labelKey: "nav.media",
    path: "/media",
    order: 60,
  },
  {
    id: "knowledge",
    moduleId: "knowledge",
    icon: KnowledgeIcon,
    labelKey: "nav.knowledge",
    path: "/knowledge",
    order: 70,
  },
];

/** 无 labelKey 的系统项 id 到 i18n key 的映射（高区/工作台项均自带 labelKey） */
const MENU_LABEL_KEYS: Record<string, string> = {
  theme: "settings.theme",
  settings: "nav.settings",
};

/**
 * 工作台四组（附录 F.3）：设置页搬出的非高频功能按域归组。
 * 每项均为独立路由页面——点击跳转，不再在设置页内嵌渲染。
 * 路由均在 routes/index.tsx 核验存在（/estop 无独立路由，保留在设置页）。
 */
interface WorkbenchGroup {
  id: string;
  labelKey: string;
  items: MenuItem[];
}
const WORKBENCH_GROUPS: WorkbenchGroup[] = [
  {
    id: "autonomy",
    labelKey: "workbench.groupAutonomy",
    items: [
      {
        id: "wb-agent",
        label: "Agent",
        icon: UsersIcon,
        labelKey: "nav.agent",
        path: "/agent",
      },
      {
        id: "wb-council",
        label: "理事会",
        icon: CouncilIcon,
        labelKey: "agent.title",
        path: "/agent/roles",
      },
      {
        id: "wb-agent-advanced",
        label: "高级",
        icon: SlidersIcon,
        labelKey: "workbench.advanced",
        path: "/agent/advanced",
      },
      {
        id: "wb-cron",
        label: "定时",
        icon: CronIcon,
        labelKey: "nav.cron",
        path: "/cron",
      },
      {
        id: "wb-loops",
        label: "循环",
        icon: ZapIcon,
        labelKey: "workbench.loops",
        path: "/loops",
      },
      {
        id: "wb-bg",
        label: "后台",
        icon: CloudIcon,
        labelKey: "nav.backgroundStatus",
        path: "/background-status",
      },
      // DevPage 废弃后归入本组（原 /dev/autoreply 孤岛）
      {
        id: "wb-autoreply",
        label: "自动回复",
        icon: ChatIcon,
        labelKey: "workbench.autoreply",
        path: "/autoreply",
      },
    ],
  },
  {
    id: "governance",
    labelKey: "workbench.groupGovernance",
    items: [
      {
        id: "wb-models",
        label: "模型",
        icon: ModelIcon,
        labelKey: "model.title",
        path: "/models",
      },
      {
        id: "wb-skills",
        label: "技能",
        icon: SkillIcon,
        labelKey: "skill.title",
        path: "/skills",
      },
      {
        id: "wb-files",
        label: "文件",
        icon: FileIcon,
        labelKey: "nav.files",
        path: "/files",
      },
      {
        id: "wb-mcp",
        label: "MCP",
        icon: McpIcon,
        labelKey: "mcp.title",
        path: "/market/mcp",
      },
      {
        id: "wb-plugins",
        label: "插件",
        icon: PluginIcon,
        labelKey: "pluginMarket.title",
        path: "/market/plugins",
      },
      {
        id: "wb-channels",
        label: "频道",
        icon: ChannelIcon,
        labelKey: "channels.title",
        path: "/channels",
      },
      {
        id: "wb-permissions",
        label: "权限",
        icon: ShieldIcon,
        labelKey: "settings.permissions",
        path: "/permissions",
      },
      {
        id: "wb-apikeys",
        label: "密钥",
        icon: KeyIcon,
        labelKey: "settings.apiKeys",
        path: "/apikeys",
      },
      {
        id: "wb-oauth",
        label: "OAuth",
        icon: LinkIcon,
        labelKey: "settings.oauth",
        path: "/oauth",
      },
    ],
  },
  {
    id: "observability",
    labelKey: "workbench.groupObservability",
    items: [
      {
        id: "wb-dashboard",
        label: "仪表盘",
        icon: DashboardIcon,
        labelKey: "nav.dashboard",
        path: "/dashboard",
      },
      {
        id: "wb-usage",
        label: "用量",
        icon: DollarIcon,
        labelKey: "workbench.usage",
        path: "/usage?tab=cost",
      },
      {
        id: "wb-logs",
        label: "日志",
        icon: DocIcon,
        labelKey: "settings.logs",
        path: "/logs",
      },
      {
        id: "wb-sandbox",
        label: "沙箱",
        icon: DatabaseIcon,
        labelKey: "settings.sandbox",
        path: "/sandbox",
      },
      {
        id: "wb-security",
        label: "安全",
        icon: ShieldIcon,
        labelKey: "settings.securityOverview",
        path: "/security",
      },
      {
        id: "wb-terminal",
        label: "终端",
        icon: DevIcon,
        labelKey: "workbench.terminal",
        path: "/terminal",
      },
      // 全路由审计（G.2-14）：/voice-stt 原为孤岛，按用户决策补入口
      {
        id: "wb-voice-test",
        label: "语音测试",
        icon: MicIcon,
        labelKey: "workbench.voiceTest",
        path: "/voice-stt",
      },
    ],
  },
  {
    id: "personal",
    labelKey: "workbench.groupPersonal",
    items: [
      {
        id: "wb-user",
        label: "用户",
        icon: UsersIcon,
        labelKey: "header.userCenter",
        path: "/user",
      },
      {
        id: "wb-help",
        label: "帮助",
        icon: BookOpenIcon,
        labelKey: "header.helpCenter",
        path: "/help",
      },
      {
        id: "wb-liri",
        label: "人格",
        icon: BuddyIcon,
        labelKey: "workbench.liri",
        path: "/liri",
      },
      {
        id: "wb-dream",
        label: "梦境",
        icon: CloudIcon,
        labelKey: "workbench.dream",
        path: "/dream",
      },
      {
        id: "wb-buddy",
        label: "伙伴",
        icon: WaveformIcon,
        labelKey: "workbench.buddy",
        path: "/buddy",
      },
    ],
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

  const labelText = t(item.labelKey || MENU_LABEL_KEYS[item.id] || item.label);

  const handleClick = () => {
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

  // P2-10：高区由模块注册表派生（selectEnabledModules），增删导航项变为数据操作
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const highFrequencyItems = useMemo<MenuItem[]>(() => {
    const enabledIds = new Set(enabledModules.map((m) => m.id));
    return HIGH_FREQ_NAV.filter(
      (meta) => !meta.moduleId || enabledIds.has(meta.moduleId),
    )
      .sort((a, b) => a.order - b.order)
      .map((meta) => ({
        id: meta.id,
        label: t(meta.labelKey),
        labelKey: meta.labelKey,
        icon: meta.icon,
        path: meta.path,
      }));
  }, [enabledModules, t]);

  /** 判断当前路由是否匹配菜单项（忽略 query string） */
  const isActive = (item: MenuItem) => {
    const normalizedPath =
      (item.path || "").split("?")[0].replace("/", "") || "home";
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
          {highFrequencyItems.map((item) => (
            <MenuButton
              key={item.id}
              item={item}
              isActive={isActive(item)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>

      {/* 工作台折叠按钮 */}
      <div className="p-1 border-t border-gray-300 dark:border-gray-700">
        <button
          onClick={() => setShowManagement(!showManagement)}
          className={`flex flex-col items-center justify-center py-2 px-2 rounded transition-colors h-14 w-full flex-shrink-0 ${
            showManagement ||
            WORKBENCH_GROUPS.some((g) => g.items.some((m) => isActive(m)))
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
            {WORKBENCH_GROUPS.map((group) => (
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
      id: "workbench",
      label: t("sidebar.workbench"),
      icon: DashboardIcon,
      onClick: () => setWorkbenchOpen(true),
    },
    {
      id: "settings",
      label: t("nav.settings"),
      icon: SettingsIcon,
      path: "/settings",
    },
  ];

  return (
    <>
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

      {/* H5 修复：移动端工作台抽屉（遮罩 + 底部面板，复用 WORKBENCH_GROUPS 四组） */}
      {workbenchOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[60] bg-black/40"
          onClick={() => setWorkbenchOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t("sidebar.workbench")}
              </span>
              <button
                onClick={() => setWorkbenchOpen(false)}
                className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400"
              >
                ✕
              </button>
            </div>
            {WORKBENCH_GROUPS.map((group) => (
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
                        <span className="w-full truncate text-center text-xs">
                          {t(
                            item.labelKey ||
                              MENU_LABEL_KEYS[item.id] ||
                              item.label,
                          )}
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
