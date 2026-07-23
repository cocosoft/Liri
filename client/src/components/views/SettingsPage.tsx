import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import i18n from "../../i18n";
import { chatService } from "../../services/chatService";
import { appConfigService } from "../../services/appConfigService";
import { setBackendPort as setBackendUrlPort } from "../../services/backendUrl";
import { httpLegacy as http } from "../../services/httpClient";
import { handleClientError } from "../../utils/handleError";
import AIConfigPanel from "../settings/AIConfigPanel";
import AutoUpdatePanel from "../settings/AutoUpdatePanel";
import FeatureFlagsPanel from "../settings/FeatureFlagsPanel";
import LocalAgentPanel from "../settings/LocalAgentPanel";
import NotificationsPanel from "../settings/NotificationsPanel";
import TrustedWorkspacesPanel from "../settings/TrustedWorkspacesPanel";
import CustomRulesPanel from "../settings/CustomRulesPanel";
import VoiceSettings from "../settings/VoiceSettings";
import KnowledgeIngestPanel from "../settings/KnowledgeIngestPanel";
import LogViewerPage from "../views/LogViewerPage";
import ModelPage from "../views/ModelPage";
import SkillPage from "../views/SkillPage";
import ChannelsPage from "../views/ChannelsPage";
import MCPMarketPage from "../views/MCPMarketPage";
import SkillMarketPage from "../views/SkillMarketPage";
import FileExplorerPage from "../views/FileExplorerPage";
import CostPage from "../views/CostPage";
import MemoryPage from "../views/MemoryPage";
import PermissionPage from "../views/PermissionPage";
import OAuthPage from "../views/OAuthPage";
import SandboxPage from "../views/SandboxPage";
import AutoReplyPage from "../views/AutoReplyPage";
import SoulPanel from "../settings/SoulPanel";
import UserPanel from "../settings/UserPanel";
import SecurityDashboard from "../views/SecurityDashboard";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
} from "../settings/ConfigComponents";
import type { BackendStatus } from "../../types";
import { useApiKeyStore } from "../../stores/authStore";
import { routerService } from "../../services/routerService";
import {
  SettingsIcon,
  MicIcon,
  KeyIcon,
  FolderOpenIcon,
  BellIcon,
  ModelIcon,
  SkillIcon,
  ShieldIcon,
  ChannelIcon,
  McpIcon,
  DollarIcon,
  FileIcon,
  CloudIcon,
  ZapIcon,
  PlayIcon,
  LinkIcon,
  SlidersIcon,
  WrenchIcon,
  BookOpenIcon,
  UserIcon,
} from "../../assets/icons";
import type { BaseIconProps } from "../../assets/icons";

/** 导航项类型 */
interface NavItem {
  id: string;
  labelKey: string;
  icon: React.ComponentType<BaseIconProps>;
  zone: string;
}

/** 导航分组定义 */
interface NavGroup {
  id: string;
  labelKey: string;
  badgeClass: string;
  items: NavItem[];
}

/** 导航分组配置 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "general",
    labelKey: "settings.categoryGeneral",
    badgeClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    items: [
      {
        id: "config",
        labelKey: "settings.generalConfig",
        icon: SettingsIcon,
        zone: "general",
      },
      {
        id: "notifications",
        labelKey: "settings.notifications",
        icon: BellIcon,
        zone: "general",
      },
      {
        id: "logs",
        labelKey: "settings.logs",
        icon: FileIcon,
        zone: "general",
      },
    ],
  },
  {
    id: "ai",
    labelKey: "settings.categoryAI",
    badgeClass:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    items: [
      {
        id: "models",
        labelKey: "settings.models",
        icon: ModelIcon,
        zone: "ai",
      },
      {
        id: "skills",
        labelKey: "settings.skills",
        icon: SkillIcon,
        zone: "ai",
      },
      {
        id: "router",
        labelKey: "settings.router",
        icon: SlidersIcon,
        zone: "ai",
      },
      { id: "soul", labelKey: "settings.soul", icon: BookOpenIcon, zone: "ai" },
      { id: "user", labelKey: "settings.user", icon: UserIcon, zone: "ai" },
      { id: "memory", labelKey: "settings.memory", icon: BookOpenIcon, zone: "ai" },
    ],
  },
  {
    id: "security",
    labelKey: "settings.categorySecurity",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    items: [
      {
        id: "apikeys",
        labelKey: "settings.apiKeys",
        icon: KeyIcon,
        zone: "security",
      },
      {
        id: "trusted-workspaces",
        labelKey: "settings.trustedWorkspaces",
        icon: FolderOpenIcon,
        zone: "security",
      },
      {
        id: "custom-rules",
        labelKey: "settings.customRules",
        icon: WrenchIcon,
        zone: "security",
      },
      {
        id: "permissions",
        labelKey: "settings.permissions",
        icon: ShieldIcon,
        zone: "security",
      },
      {
        id: "oauth",
        labelKey: "settings.oauth",
        icon: LinkIcon,
        zone: "security",
      },
      {
        id: "security-dashboard",
        labelKey: "settings.securityLog",
        icon: ShieldIcon,
        zone: "security",
      },
    ],
  },
  {
    id: "integration",
    labelKey: "settings.categoryIntegration",
    badgeClass:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    items: [
      {
        id: "channels",
        labelKey: "settings.channels",
        icon: ChannelIcon,
        zone: "integration",
      },
      {
        id: "voice",
        labelKey: "settings.voice",
        icon: MicIcon,
        zone: "integration",
      },
      {
        id: "mcp",
        labelKey: "settings.mcp",
        icon: McpIcon,
        zone: "integration",
      },
      {
        id: "skill-market",
        labelKey: "settings.skillMarket",
        icon: CloudIcon,
        zone: "integration",
      },
      {
        id: "autoreply",
        labelKey: "settings.autoReply",
        icon: ZapIcon,
        zone: "integration",
      },
    ],
  },
  {
    id: "storage",
    labelKey: "settings.categoryStorage",
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    items: [
      {
        id: "data-dir",
        labelKey: "settings.dataDir",
        icon: FolderOpenIcon,
        zone: "storage",
      },
      {
        id: "files",
        labelKey: "settings.files",
        icon: FileIcon,
        zone: "storage",
      },
      {
        id: "ingest",
        labelKey: "settings.ingest",
        icon: BookOpenIcon,
        zone: "storage",
      },
      {
        id: "cost",
        labelKey: "settings.cost",
        icon: DollarIcon,
        zone: "storage",
      },
      {
        id: "sandbox",
        labelKey: "settings.sandbox",
        icon: PlayIcon,
        zone: "storage",
      },
    ],
  },
];

/** 获取所有导航项 */
const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** 数据目录 API 响应 */
interface DataDirectoryResponse {
  currentDirectory: string;
  configuredDirectory: string | null;
  defaultDirectory: string;
  envLiriHome?: string | null;
  envLiriDataDir?: string | null;
}
interface SetDataDirectoryResponse {
  success: boolean;
  message: string;
  directory: string;
  migration?: {
    copied: number;
    skipped: number;
    errors: string[];
    cleaned?: number;
    cleanedErrors?: string[];
  };
}

/** 侧边栏选中项持久化 */
const ACTIVE_NAV_KEY = "liri-settings-active-nav";
function getPersistedNav(fallback: string): string {
  try {
    const s = localStorage.getItem(ACTIVE_NAV_KEY);
    if (s && ALL_NAV_ITEMS.some((n) => n.id === s)) return s;
  } catch {
    /* ignore */
  }
  return fallback;
}

/** 时区选项 */
const TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "UTC+8 上海/北京" },
  { value: "Asia/Tokyo", label: "UTC+9 东京" },
  { value: "Asia/Seoul", label: "UTC+9 首尔" },
  { value: "Asia/Singapore", label: "UTC+8 新加坡" },
  { value: "Asia/Kolkata", label: "UTC+5:30 印度" },
  { value: "Asia/Dubai", label: "UTC+4 迪拜" },
  { value: "Europe/London", label: "UTC+0 伦敦" },
  { value: "Europe/Paris", label: "UTC+1 巴黎" },
  { value: "Europe/Berlin", label: "UTC+1 柏林" },
  { value: "Europe/Moscow", label: "UTC+3 莫斯科" },
  { value: "America/New_York", label: "UTC-5 纽约" },
  { value: "America/Chicago", label: "UTC-6 芝加哥" },
  { value: "America/Los_Angeles", label: "UTC-8 洛杉矶" },
  { value: "America/Sao_Paulo", label: "UTC-3 圣保罗" },
  { value: "Australia/Sydney", label: "UTC+10 悉尼" },
  { value: "Pacific/Auckland", label: "UTC+12 奥克兰" },
  { value: "UTC", label: "UTC+0 协调世界时" },
];

function SettingsPage() {
  const { t } = useTranslation();
  const { config, setConfig } = useConfigStore();
  const [activeNav, setActiveNav] = useState(() => getPersistedNav("config"));
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    running: false,
    port: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendPort, setBackendPort] = useState("7890");
  const [portSaved, setPortSaved] = useState(false);
  const [dataDirectory, setDataDirectory] = useState("");
  const [configuredDirectory, setConfiguredDirectory] = useState<string | null>(
    null,
  );
  const [defaultDirectory, setDefaultDirectory] = useState("");
  const [dataDirSaved, setDataDirSaved] = useState(false);
  const [dataDirError, setDataDirError] = useState<string | null>(null);
  const [migrateData, setMigrateData] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{
    copied: number;
    skipped: number;
    errors: string[];
    cleaned?: number;
    cleanedErrors?: string[];
  } | null>(null);
  const [envLiriHome, setEnvLiriHome] = useState<string | null>(null);
  const [envLiriDataDir, setEnvLiriDataDir] = useState<string | null>(null);
  const isDark = config.theme === "dark";

  /** 导航切换 */
  const switchNav = (id: string) => {
    setActiveNav(id);
    try {
      localStorage.setItem(ACTIVE_NAV_KEY, id);
    } catch {
      /* ignore */
    }
  };

  // ── 初始化 ──
  useEffect(() => {
    loadPersistedPort();
    loadDataDirectory();
    checkBackendStatus();
    const iv = setInterval(checkBackendStatus, 5000);
    return () => clearInterval(iv);
  }, []);

  // ── 数据目录 ──
  const loadDataDirectory = async () => {
    try {
      const r = await http.get<DataDirectoryResponse>(
        "/v1/settings/data-directory",
      );
      if (r) {
        setDataDirectory(r.currentDirectory || "");
        setConfiguredDirectory(r.configuredDirectory || null);
        setDefaultDirectory(r.defaultDirectory || "");
        if ("envLiriHome" in r) setEnvLiriHome(r.envLiriHome ?? null);
        if ("envLiriDataDir" in r) setEnvLiriDataDir(r.envLiriDataDir ?? null);
      }
    } catch {
      /* ignore */
    }
  };
  const handleSaveDataDirectory = async () => {
    if (!dataDirectory.trim()) {
      setDataDirError("目录路径不能为空");
      return;
    }
    setDataDirSaved(false);
    setDataDirError(null);
    setMigrationResult(null);
    setMigrating(migrateData);
    try {
      const r = await http.put<SetDataDirectoryResponse>(
        "/v1/settings/data-directory",
        { directory: dataDirectory, migrate: migrateData },
      );
      if (r?.success) {
        setConfiguredDirectory(dataDirectory);
        setDataDirSaved(true);
        if (r.migration) setMigrationResult(r.migration);
        setTimeout(() => {
          setDataDirSaved(false);
          setMigrationResult(null);
        }, 8000);
      }
    } catch (e: any) {
      setDataDirError(e.response?.data?.error?.message || "保存失败");
    } finally {
      setMigrating(false);
    }
  };
  const handleResetDataDirectory = async () => {
    try {
      await http.put("/v1/settings/data-directory", {
        directory: defaultDirectory,
        migrate: migrateData,
      });
      setDataDirectory(defaultDirectory);
      setConfiguredDirectory(null);
      setDataDirSaved(true);
      setTimeout(() => setDataDirSaved(false), 3000);
    } catch {
      /* ignore */
    }
  };

  // ── 端口 ──
  const loadPersistedPort = async () => {
    try {
      const a = await appConfigService.get();
      setBackendPort(String(a.httpPort));
    } catch {
      /* ignore */
    }
  };
  const handleSavePort = async () => {
    const port = parseInt(backendPort, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      setError("端口号必须在 1024-65535 之间");
      return;
    }
    setPortSaved(false);
    setError(null);
    try {
      await appConfigService.set({
        ...(await appConfigService.get()),
        httpPort: port,
      });
      setBackendUrlPort(port);
      if (
        typeof window !== "undefined" &&
        ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
      ) {
        try {
          const c = await import("@tauri-apps/api/core");
          if (c && typeof c.invoke === "function")
            await c.invoke("set_backend_port", { port });
        } catch {
          /* ignore */
        }
      }
      setPortSaved(true);
      setTimeout(() => setPortSaved(false), 3000);
    } catch (e) {
      setError(String(e));
    }
  };

  // ── 后端 ──
  const checkBackendStatus = async () => {
    try {
      const s = await chatService.getBackendStatus();
      setBackendStatus(s);
      if (s.port) setBackendPort(String(s.port));
    } catch {
      setBackendStatus({ running: false, port: null });
    }
  };
  const handleStartBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      await chatService.startBackend();
      await checkBackendStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const handleStopBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      await chatService.stopBackend();
      await checkBackendStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleTheme = () => setConfig("theme", isDark ? "light" : "dark");

  return (
    <div className="flex flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-900">
      {/* ── 左侧导航 ── */}
      <aside className="w-52 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t("settings.title")}
          </h2>
        </div>
        <nav className="pb-6">{renderSidebar()}</nav>
      </aside>

      {/* ── 右侧主内容区（横向填满）── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800">
        {renderContent()}
      </main>
    </div>
  );

  function renderSidebar() {
    return NAV_GROUPS.map((group) => (
      <div key={group.id} className="mb-2">
        {/* 分组标题 */}
        <div className="px-4 pt-3 pb-1">
          <span
            className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${group.badgeClass}`}
          >
            {t(group.labelKey)}
          </span>
        </div>
        {/* 分组导航项 */}
        {group.items.map((item) => {
          const isActive = activeNav === item.id;
          const IconComponent = item.icon;
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
              <IconComponent size={18} />
              <span className="truncate">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    ));
  }

  function renderContent() {
    switch (activeNav) {
      case "config":
        return (
          <>
            {renderAppearance()}
            {renderBackendService()}
            <AIConfigPanel
              isDark={isDark}
              config={(config.ai as Record<string, unknown>) || {}}
              onUpdate={(updates) =>
                setConfig("ai", {
                  ...((config.ai as object) || {}),
                  ...updates,
                })
              }
            />
            <FeatureFlagsPanel
              isDark={isDark}
              features={
                ((config.features as Record<string, unknown>) || {
                  autoCompact: true,
                  showTurnDuration: true,
                  fileCheckpointing: true,
                  terminalProgressBar: true,
                  showStatusInTerminalTab: false,
                  respectGitignore: true,
                  copyFullResponse: false,
                  todoEnabled: true,
                  showExpandedTodos: false,
                }) as unknown as Parameters<
                  typeof FeatureFlagsPanel
                >[0]["features"]
              }
              onUpdate={(u) =>
                setConfig("features", {
                  ...((config.features as object) || {}),
                  ...u,
                })
              }
            />
            <LocalAgentPanel
              isDark={isDark}
              localAgent={
                (() => {
                  const raw = (config.ai as Record<string, unknown>)
                    ?.localAgent as Record<string, unknown> | undefined;
                  // 深合并默认值，确保 routing 不会因残缺的已存储数据而丢失
                  return {
                    enabled: false,
                    routing: {
                      strategy: "cloud-first" as const,
                      fallbackToCloud: true,
                    },
                    ...(raw || {}),
                  };
                })() as unknown as Parameters<
                  typeof LocalAgentPanel
                >[0]["localAgent"]
              }
              ollama={
                ((
                  (config.ai as Record<string, unknown>)?.localAgent as Record<
                    string,
                    unknown
                  >
                )?.ollama || {
                  enabled: false,
                  baseUrl: "http://localhost:11434",
                  defaultModel: "llama3",
                  timeout: 120000,
                }) as unknown as Parameters<typeof LocalAgentPanel>[0]["ollama"]
              }
              onUpdateLocalAgent={(u) =>
                setConfig("ai", {
                  ...((config.ai as object) || {}),
                  localAgent: {
                    // 提供 routing 默认值，防止首次启用时 routing 为 undefined 导致崩溃
                    routing: {
                      strategy: "cloud-first" as const,
                      fallbackToCloud: true,
                    },
                    ...(((config.ai as Record<string, unknown>)
                      ?.localAgent as object) || {}),
                    ...u,
                  },
                })
              }
              onUpdateOllama={(u) =>
                setConfig("ai", {
                  ...((config.ai as object) || {}),
                  localAgent: {
                    // 提供 routing 默认值，防止首次启用时 routing 为 undefined 导致崩溃
                    routing: {
                      strategy: "cloud-first" as const,
                      fallbackToCloud: true,
                    },
                    ...(((config.ai as Record<string, unknown>)
                      ?.localAgent as object) || {}),
                    ollama: {
                      ...(((
                        (config.ai as Record<string, unknown>)
                          ?.localAgent as Record<string, unknown>
                      )?.ollama as object) || {}),
                      ...u,
                    },
                  },
                })
              }
            />
            <AutoUpdatePanel
              isDark={isDark}
              autoUpdate={
                (config.autoUpdate as {
                  enabled: boolean;
                  checkIntervalMs: number;
                  channel: "stable" | "beta";
                  checkOnStartup: boolean;
                  verbose: boolean;
                }) || {
                  enabled: true,
                  checkIntervalMs: 86400000,
                  channel: "stable",
                  checkOnStartup: true,
                  verbose: false,
                }
              }
              onUpdate={(u) =>
                setConfig("autoUpdate", {
                  ...((config.autoUpdate as object) || {}),
                  ...u,
                })
              }
            />
            <NotificationsPanel
              isDark={isDark}
              notifications={
                ((config.notifications as Record<string, unknown>) || {
                  preferredChannel: "auto",
                  idleThresholdMs: 60000,
                  taskCompleteEnabled: true,
                  inputNeededEnabled: true,
                  agentPushEnabled: true,
                }) as unknown as Parameters<
                  typeof NotificationsPanel
                >[0]["notifications"]
              }
              onUpdate={(u) =>
                setConfig("notifications", {
                  ...((config.notifications as object) || {}),
                  ...u,
                })
              }
            />
          </>
        );
      case "notifications":
        return (
          <NotificationsPanel
            isDark={isDark}
            notifications={
              ((config.notifications as Record<string, unknown>) || {
                preferredChannel: "auto",
                idleThresholdMs: 60000,
                taskCompleteEnabled: true,
                inputNeededEnabled: true,
                agentPushEnabled: true,
              }) as unknown as Parameters<
                typeof NotificationsPanel
              >[0]["notifications"]
            }
            onUpdate={(u) =>
              setConfig("notifications", {
                ...((config.notifications as object) || {}),
                ...u,
              })
            }
          />
        );
      case "logs":
        return <LogViewerPage />;
      case "models":
        return <ModelManagementContent isDark={isDark} />;
      case "skills":
        return <SkillManagementContent isDark={isDark} />;
      case "router":
        return (
          <RouterConfigContent
            isDark={isDark}
            config={config}
            setConfig={setConfig}
          />
        );
      case "soul":
        return <SoulPanel isDark={isDark} />;
      case "user":
        return <UserPanel isDark={isDark} />;
      case "apikeys":
        return <ApiKeyContent />;
      case "trusted-workspaces":
        return <TrustedWorkspacesPanel isDark={isDark} />;
      case "custom-rules":
        return <CustomRulesPanel isDark={isDark} />;
      case "permissions":
        return <PermissionManagementContent isDark={isDark} />;
      case "oauth":
        return <OAuthManagementContent isDark={isDark} />;
      case "security-dashboard":
        return <SecurityDashboard />;
      case "channels":
        return <ChannelsManagementContent isDark={isDark} />;
      case "voice":
        return <VoiceSettings isDark={isDark} />;
      case "mcp":
        return <MCPMarketContent isDark={isDark} />;
      case "skill-market":
        return <SkillMarketContent isDark={isDark} />;
      case "autoreply":
        return <AutoReplyManagementContent isDark={isDark} />;
      case "data-dir":
        return renderDataStorage();
      case "files":
        return <FileManagementContent isDark={isDark} />;
      case "ingest":
        return <KnowledgeIngestPanel isDark={isDark} />;
      case "cost":
        return <CostStatisticsContent isDark={isDark} />;
      case "sandbox":
        return <SandboxManagementContent isDark={isDark} />;
      case "memory":
        return <MemoryPage />;
      default:
        return null;
    }
  }

  function renderAppearance() {
    const language =
      (config.language as string) || navigator.language || "zh-CN";
    const timezone =
      (config.timezone as string) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "Asia/Shanghai";

    /** 已支持的语言（有翻译文件） */
    const SUPPORTED_LANGUAGES = [
      { value: "zh-CN", label: "简体中文" },
      { value: "en-US", label: "English (US)" },
    ];

    /** 计划中的语言（无翻译文件，切换后仍显示中文） */
    const PLANNED_LANGUAGES = [
      { value: "zh-TW", label: "繁體中文 (即將支援)" },
      { value: "en-GB", label: "English (UK) (coming soon)" },
      { value: "ja-JP", label: "日本語 (coming soon)" },
      { value: "ko-KR", label: "한국어 (coming soon)" },
      { value: "fr-FR", label: "Français (à venir)" },
      { value: "de-DE", label: "Deutsch (demnächst)" },
      { value: "es-ES", label: "Español (próximamente)" },
      { value: "pt-BR", label: "Português (BR) (em breve)" },
      { value: "ru-RU", label: "Русский (скоро)" },
      { value: "ar-SA", label: "العربية (قريباً)" },
    ];

    const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const lang = e.target.value;
      setConfig("language", lang);
      // 立即切换 i18n 语言
      const i18nLang = lang.startsWith("zh")
        ? "zh"
        : lang.startsWith("en")
          ? "en"
          : "zh";
      i18n.changeLanguage(i18nLang);
    };

    const currentThemeLabel = isDark ? t("settings.dark") : t("settings.light");

    return (
      <ConfigSection
        title={t("settings.appearance")}
        description={t("settings.appearanceDesc")}
        isDark={isDark}
      >
        <ConfigItem
          label={t("settings.theme")}
          description={`${t("settings.current")}: ${currentThemeLabel}`}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={isDark}
            onChange={toggleTheme}
          />
        </ConfigItem>
        <ConfigItem label={t("settings.language")} isDark={isDark}>
          <select
            value={language}
            onChange={handleLanguageChange}
            className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
          >
            <optgroup label="---">
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("settings.comingSoon")}>
              {PLANNED_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value} disabled>
                  {l.label}
                </option>
              ))}
            </optgroup>
          </select>
        </ConfigItem>
        <ConfigItem label={t("settings.timezone")} isDark={isDark}>
          <select
            value={timezone}
            onChange={(e) => setConfig("timezone", e.target.value)}
            className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </ConfigItem>
      </ConfigSection>
    );
  }

  function renderBackendService() {
    const statusText = backendStatus.running
      ? `${t("settings.backendStatusRunning")} (${t("settings.backendPort")} ${backendStatus.port})`
      : t("settings.backendStatusStopped");
    return (
      <ConfigSection
        title={t("settings.backendService")}
        description={t("settings.backendServiceDesc")}
        isDark={isDark}
      >
        <ConfigItem
          label={t("settings.backendStatus")}
          description={statusText}
          isDark={isDark}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${backendStatus.running ? "bg-green-500" : "bg-red-500"}`}
          />
        </ConfigItem>
        <ConfigItem label={t("settings.backendPort")} isDark={isDark}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={backendPort}
              onChange={(e) => setBackendPort(e.target.value)}
              disabled={backendStatus.running}
              className="w-28 px-2 py-1 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
            />
            <button
              onClick={handleSavePort}
              disabled={backendStatus.running}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("settings.applyPort")}
            </button>
            {portSaved && (
              <span className="text-xs text-green-500">
                {t("settings.portSaved")}
              </span>
            )}
          </div>
        </ConfigItem>
        {error && (
          <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
            {error}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          {backendStatus.running ? (
            <button
              onClick={handleStopBackend}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t("settings.processing") : t("settings.stop")}
            </button>
          ) : (
            <button
              onClick={handleStartBackend}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t("settings.processing") : t("settings.start")}
            </button>
          )}
          <button
            onClick={checkBackendStatus}
            className="px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            {t("settings.refreshStatus")}
          </button>
        </div>
      </ConfigSection>
    );
  }

  function renderDataStorage() {
    // 构建生效目录信息行
    const effectiveDir =
      configuredDirectory || defaultDirectory || dataDirectory;
    let envInfo: string | null = null;
    if (
      envLiriHome &&
      configuredDirectory &&
      envLiriHome !== configuredDirectory
    ) {
      envInfo = `环境变量 LIRI_HOME 已设置 → ${envLiriHome}（设置页保存的目录优先）`;
    } else if (envLiriHome && !configuredDirectory) {
      envInfo = `环境变量 LIRI_HOME 已设置 → ${envLiriHome}`;
    } else if (envLiriDataDir) {
      envInfo = `环境变量 LIRI_DATA_DIR 已设置 → ${envLiriDataDir}`;
    }

    return (
      <ConfigSection
        title="数据目录"
        description="配置数据文件存储位置"
        isDark={isDark}
      >
        {/* 当前生效目录提示行 */}
        <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs">
          <p className="text-blue-700 dark:text-blue-300">
            <span className="font-medium">当前生效目录：</span>
            <code className="ml-1">{effectiveDir}</code>
          </p>
          {envInfo && (
            <p className="text-yellow-600 dark:text-yellow-400 mt-1">
              ⚠️ {envInfo}
            </p>
          )}
        </div>

        <input
          type="text"
          value={dataDirectory}
          onChange={(e) => setDataDirectory(e.target.value)}
          placeholder="请输入数据目录路径"
          className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
        />
        {configuredDirectory && (
          <p className="text-xs text-gray-500 mt-2">当前已配置自定义目录</p>
        )}
        {!configuredDirectory && defaultDirectory && (
          <p className="text-xs text-gray-500 mt-2">
            默认目录: {defaultDirectory}
          </p>
        )}
        {dataDirError && (
          <p className="text-xs text-red-500 mt-2">{dataDirError}</p>
        )}
        <div className="flex items-center gap-2 mt-3">
          <input
            type="checkbox"
            id="migrateData"
            checked={migrateData}
            onChange={(e) => setMigrateData(e.target.checked)}
            className="w-4 h-4"
          />
          <label
            htmlFor="migrateData"
            className="text-sm text-gray-700 dark:text-gray-300"
          >
            迁移现有数据
          </label>
        </div>

        {/* 迁移进度指示 */}
        {migrating && (
          <div className="mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded">
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-amber-700 dark:text-amber-300">
                正在迁移数据，请稍候...
              </span>
            </div>
          </div>
        )}

        {migrationResult && <MigrationResult result={migrationResult} />}
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleSaveDataDirectory}
            disabled={migrating}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用
          </button>
          {configuredDirectory && (
            <button
              onClick={handleResetDataDirectory}
              disabled={migrating}
              className="px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              恢复默认
            </button>
          )}
          {dataDirSaved && !migrationResult && (
            <span className="text-xs text-green-500 self-center">已保存</span>
          )}
        </div>
      </ConfigSection>
    );
  }
}

/* ── API 密钥嵌入组件 ── */

function ApiKeyContent() {
  const { apiKeys, isLoading, error, loadApiKeys, createApiKey, deleteApiKey } =
    useApiKeyStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setCreateError("请输入密钥名称");
      return;
    }
    setCreateError(null);
    try {
      const key = await createApiKey(newKeyName, ["read"], 90);
      setNewKeyValue(key);
      setNewKeyName("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个 API 密钥吗？此操作不可撤销。")) return;
    try {
      await deleteApiKey(id);
    } catch (e) {
      handleClientError(e, { module: "components:views:Settings", action: "deleteApiKey" });
    }
  };

  const handleCopy = async () => {
    if (newKeyValue) {
      try {
        await navigator.clipboard.writeText(newKeyValue);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        handleClientError(e, { module: "components:views:Settings", action: "copyKey" });
      }
    }
  };

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            API 密钥管理
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            管理您的 API 密钥，用于程序化访问
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreateModal(true);
            setNewKeyValue(null);
            setNewKeyName("");
            setCreateError(null);
          }}
          className="px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          创建密钥
        </button>
      </div>

      {(error || createError) && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error || createError}
        </div>
      )}

      {isLoading && apiKeys.length === 0 ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : apiKeys.length === 0 ? (
        <div className="text-center py-12 rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <svg
            className="w-12 h-12 mx-auto mb-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <p className="text-gray-500">暂无 API 密钥</p>
          <p className="mt-1 text-sm text-gray-400">
            点击上方按钮创建一个新的 API 密钥
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3 font-medium">名称</th>
                <th className="px-4 py-3 font-medium">密钥</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">最后使用</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {apiKeys.map((key) => (
                <tr key={key.id} className="text-gray-700 dark:text-gray-300">
                  <td className="px-4 py-3 font-medium">{key.name}</td>
                  <td className="px-4 py-3 font-mono text-sm">
                    {key.key_prefix}...****
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {formatDate(key.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {key.last_used_at
                      ? formatDate(key.last_used_at)
                      : "从未使用"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-w-md w-full mx-4 p-6 rounded-xl bg-white dark:bg-gray-800">
            {newKeyValue ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  密钥已创建
                </h3>
                <div className="p-3 rounded bg-gray-50 dark:bg-gray-700">
                  <code className="text-sm break-all text-gray-800 dark:text-gray-200">
                    {newKeyValue}
                  </code>
                </div>
                <p className="text-xs text-red-500 mt-2">
                  请立即复制，关闭后将无法再次查看
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleCopy}
                    className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {copied ? "已复制" : "复制密钥"}
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  创建新密钥
                </h3>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="密钥名称"
                  className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 mb-4"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    创建
                  </button>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 内部组件 ── */

function MigrationResult({
  result,
}: {
  result: {
    copied: number;
    skipped: number;
    errors: string[];
    cleaned?: number;
    cleanedErrors?: string[];
  };
}) {
  return (
    <div
      className={`mt-3 p-3 rounded ${
        result.errors.length > 0
          ? "bg-yellow-50 dark:bg-yellow-900/20"
          : "bg-green-50 dark:bg-green-900/20"
      }`}
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">
        迁移完成：<span className="font-medium">{result.copied}</span>{" "}
        个已迁移，{result.skipped} 个已跳过
      </p>
      {result.cleaned !== undefined && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          旧目录已清理 {result.cleaned} 项，释放磁盘空间
        </p>
      )}
      {result.errors.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-red-500">迁移错误:</p>
          {result.errors.slice(0, 3).map((err, idx) => (
            <p key={idx} className="text-xs text-red-500">
              {err}
            </p>
          ))}
        </div>
      )}
      {result.cleanedErrors && result.cleanedErrors.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-yellow-500">旧目录清理警告:</p>
          {result.cleanedErrors.slice(0, 3).map((err, idx) => (
            <p key={idx} className="text-xs text-yellow-500">
              {err}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 新增内容组件 ── */

/** 模型管理内容 — 内联渲染完整模型管理页面 */
function ModelManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <ModelPage />;
}

/** 技能管理内容 */
function SkillManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <SkillPage />;
}

/** 智能路由配置内容 */
function RouterConfigContent({
  isDark,
  config,
  setConfig,
}: {
  isDark: boolean;
  config: Record<string, unknown>;
  setConfig: (key: string, value: unknown) => void;
}) {
  const [routerExpanded, setRouterExpanded] = useState(false);

  const smartRouter = (config["models.router"] as {
    enabled: boolean;
    defaultTier: string;
    sessionSticky: boolean;
  }) || { enabled: true, defaultTier: "medium", sessionSticky: true };

  // 同步路由配置到后端运行时
  const syncRouterConfig = async (updated: typeof smartRouter) => {
    try {
      await routerService.updateConfig(updated);
    } catch {
      // 后端不可用时静默失败，配置仍保留在本地
    }
  };

  const handleToggleEnabled = (checked: boolean) => {
    const updated = { ...smartRouter, enabled: checked };
    setConfig("models.router", updated);
    syncRouterConfig(updated);
  };

  const handleChangeDefaultTier = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const updated = { ...smartRouter, defaultTier: e.target.value };
    setConfig("models.router", updated);
    syncRouterConfig(updated);
  };

  const handleToggleSticky = (checked: boolean) => {
    const updated = { ...smartRouter, sessionSticky: checked };
    setConfig("models.router", updated);
    syncRouterConfig(updated);
  };

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        智能路由配置
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        由 LLM Judge 自动分级调度模型
      </p>
      <ConfigSection
        title="SmartRouter"
        description="根据任务复杂度自动选择合适的模型"
        isDark={isDark}
      >
        <ConfigItem label="启用 SmartRouter" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={smartRouter.enabled}
            onChange={handleToggleEnabled}
          />
        </ConfigItem>
        {smartRouter.enabled && (
          <ConfigItem label="默认等级" isDark={isDark}>
            <select
              value={smartRouter.defaultTier}
              onChange={handleChangeDefaultTier}
              className="px-3 py-1.5 text-sm rounded-md border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
            >
              <option value="simple">Simple - 简单问答</option>
              <option value="medium">Medium - 常规对话</option>
              <option value="complex">Complex - 复杂任务</option>
              <option value="reasoning">Reasoning - 深度推理</option>
            </select>
          </ConfigItem>
        )}
        {smartRouter.enabled && (
          <button
            onClick={() => setRouterExpanded(!routerExpanded)}
            className="text-xs text-blue-500 hover:text-blue-400 focus:outline-none ml-0.5"
          >
            {routerExpanded ? "收起详情 ▲" : "展开详情 ▼"}
          </button>
        )}
        {smartRouter.enabled && routerExpanded && (
          <div className="space-y-2 mt-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">会话黏性</span>
              <ToggleConfig
                isDark={isDark}
                checked={smartRouter.sessionSticky}
                onChange={handleToggleSticky}
              />
            </div>
            <div className="text-gray-400">
              Judge 模型:{" "}
              <span className="text-gray-500">
                使用 LocalAgent 本地模型判定
              </span>
            </div>
          </div>
        )}
      </ConfigSection>
    </div>
  );
}

/** 权限管理内容 */
function PermissionManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <PermissionPage />;
}

/** OAuth 认证管理内容 */
function OAuthManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <OAuthPage />;
}

/** 消息渠道管理内容 */
function ChannelsManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <ChannelsPage />;
}

/** MCP 市场内容 */
function MCPMarketContent({ isDark: _isDark }: { isDark: boolean }) {
  return <MCPMarketPage />;
}

/** 技能市场内容 */
function SkillMarketContent({ isDark: _isDark }: { isDark: boolean }) {
  return <SkillMarketPage />;
}

/** 自动回复管理内容 */
function AutoReplyManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <AutoReplyPage />;
}

/** 文件管理内容 */
function FileManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <FileExplorerPage />;
}

/** 成本统计内容 */
function CostStatisticsContent({ isDark: _isDark }: { isDark: boolean }) {
  return <CostPage />;
}

/** 沙箱管理内容 */
function SandboxManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return <SandboxPage />;
}

export default SettingsPage;
