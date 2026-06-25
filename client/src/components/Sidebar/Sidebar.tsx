import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useConfigStore } from "../../stores/configStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { HomeIcon, ChatIcon, TaskIcon, DevIcon, CronIcon, KnowledgeIcon, ModelIcon, SkillIcon, FileIcon, McpIcon, ChannelIcon, ThemeIcon, SettingsIcon, CouncilIcon, WaveformIcon } from "../../assets/icons";

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
  { id: "tasks", label: "工作", icon: TaskIcon, path: "/tasks" },
  { id: "coding", label: "开发", icon: DevIcon, path: "/dev/terminal" },
  { id: "cron", label: "定时", icon: CronIcon, path: "/cron" },
  { id: "knowledge", label: "知识库", icon: KnowledgeIcon, path: "/knowledge" },
  { id: "tts", label: "语音合成", icon: WaveformIcon, path: "/tts" },
];

/** 管理折叠：模型/技能/MCP/频道/文件 */
const MANAGEMENT_ITEMS: MenuItem[] = [
  { id: "models", label: "模型", icon: ModelIcon, path: "/models" },
  { id: "skills", label: "技能", icon: SkillIcon, path: "/skills" },
  { id: "files", label: "文件", icon: FileIcon, path: "/files" },
  { id: "mcp", label: "MCP", icon: McpIcon, path: "/market/mcp" },
  { id: "channels", label: "频道", icon: ChannelIcon, path: "/channels" },
  { id: "council-roles", label: "理事会", icon: CouncilIcon, path: "/agent/roles" },
];

const SYSTEM_ITEMS: MenuItem[] = [
  { id: "theme", label: "主题", icon: ThemeIcon },
  { id: "settings", label: "设置", icon: SettingsIcon, path: "/settings" },
];

function MenuButton({ item, isActive, onNavigate }: {
  item: MenuItem;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const isDark = config.theme === "dark";

  /** 获取实际导航路径，"工作"按钮根据当前工作空间动态决定 */
  const getActualPath = (): string | undefined => {
    if (item.id === "tasks") {
      // 有当前工作空间时跳到对应工作界面，否则用 "default" 占位
      return currentWorkspace?.id
        ? `/workspace/${currentWorkspace.id}/work`
        : "/workspace/default/work";
    }
    return item.path;
  };

  const handleClick = () => {
    const actualPath = getActualPath();
    if (actualPath) {
      if (actualPath.startsWith("/workspace/")) {
        setActivePage("workspace");
      } else if (actualPath === "/") {
        setActivePage("home");
      } else {
        const pageId = actualPath.replace("/", "") || "chat";
        setActivePage(pageId as any);
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
        title={isDark ? "切换到浅色模式" : "切换到深色模式"}
      >
        <ThemeIcon size={20} />
        <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
          {isDark ? "浅色" : "深色"}
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
      title={item.label}
    >
      <IconComponent size={20} />
      <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
        {item.label}
      </span>
    </button>
  );
}

/**
 * 工作空间选择器：侧栏顶部图标按钮 + 下拉菜单
 * 已迁移至 Header 右上角的 WorkspaceSwitcher 组件。
 * 保留空壳避免 Sidebar 布局变化。
 */

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const activeRoute = location.pathname.replace("/", "") || "home";
  const [showManagement, setShowManagement] = useState(false);

  /** 判断当前路由是否匹配菜单项 */
  const isActive = (item: MenuItem) => {
    // "工作"按钮：匹配 /tasks、/work、/workspace/* 路由
    if (item.id === "tasks") {
      return activeRoute === "tasks" || activeRoute === "work" || activeRoute.startsWith("workspace/");
    }
    const normalizedPath = (item.path || "").replace("/", "") || "home";
    return (
      activeRoute === normalizedPath ||
      activeRoute.startsWith(normalizedPath + "/") ||
      // 开发工具子路由
      (normalizedPath.startsWith("dev/") &&
       activeRoute.startsWith("dev/"))
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
          title="管理"
        >
          <SettingsIcon size={20} />
          <span className="text-xs mt-1 truncate w-full text-center h-4 flex items-center justify-center">
            管理
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
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute = location.pathname.replace("/", "") || "home";
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);

  const items: MenuItem[] = [
    { id: "home", label: "首页", icon: HomeIcon, path: "/" },
    { id: "chat", label: "聊天", icon: ChatIcon, path: "/chat" },
    { id: "tasks", label: "工作", icon: TaskIcon, path: "/tasks" },
    { id: "cron", label: "定时", icon: CronIcon, path: "/cron" },
    { id: "settings", label: "设置", icon: SettingsIcon, path: "/settings" },
  ];

  /** "工作"按钮实际导航路径，与桌面端逻辑一致 */
  const getTasksPath = (): string => {
    return currentWorkspace?.id
      ? `/workspace/${currentWorkspace.id}/work`
      : "/workspace/default/work";
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-around py-1 z-50 safe-area-bottom">
      {items.map((item) => {
        const isActive = item.id === "tasks"
          ? activeRoute === "tasks" || activeRoute.startsWith("workspace/")
          : activeRoute === (item.path?.replace("/", "") || "home");
        const IconComponent = item.icon;
        const actualPath = item.id === "tasks" ? getTasksPath() : item.path!;
        return (
          <button
            key={item.id}
            onClick={() => { navigate(actualPath); }}
            className={`flex flex-col items-center px-2 py-1 min-w-0 ${
              isActive ? "text-blue-600" : "text-gray-500 dark:text-gray-400"
            }`}
          >
            <IconComponent size={18} />
            <span className="text-xs mt-0.5">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default Sidebar;
export { MobileBottomNav };
