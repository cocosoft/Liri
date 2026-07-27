import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { chatService } from "../../services/chatService";
import { appConfigService } from "../../services/appConfigService";
import { setBackendPort as setBackendUrlPort } from "../../services/backendUrl";
import { httpLegacy as http } from "../../services/httpClient";
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
import MemoryPage from "../views/MemoryPage";
import PermissionPage from "../views/PermissionPage";
import OAuthPage from "../views/OAuthPage";
import SandboxPage from "../views/SandboxPage";
import SoulPanel from "../settings/SoulPanel";
import UserPanel from "../settings/UserPanel";
import AppearancePanel from "../settings/AppearancePanel";
import ApiKeyContent from "../settings/ApiKeyContent";
import BackendServicePanel from "../settings/BackendServicePanel";
import DataStoragePanel from "../settings/DataStoragePanel";
import SecurityDashboard from "../views/SecurityDashboard";
import UsageCenterPage from "../views/UsageCenterPage";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
} from "../settings/ConfigComponents";
import type { BackendStatus } from "../../types";
import { routerService } from "../../services/routerService";
import {
  SettingsIcon,
  MicIcon,
  KeyIcon,
  FolderOpenIcon,
  BellIcon,
  ShieldIcon,
  DollarIcon,
  FileIcon,
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
        id: "router",
        labelKey: "settings.router",
        icon: SlidersIcon,
        zone: "ai",
      },
      { id: "soul", labelKey: "settings.soul", icon: BookOpenIcon, zone: "ai" },
      { id: "user", labelKey: "settings.user", icon: UserIcon, zone: "ai" },
      {
        id: "memory",
        labelKey: "settings.memory",
        icon: BookOpenIcon,
        zone: "ai",
      },
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
        id: "voice",
        labelKey: "settings.voice",
        icon: MicIcon,
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

/** 页面描述映射（nav ID → 中文描述） */
const PAGE_DESCRIPTIONS: Record<string, string> = {
  config: "外观、后端服务、AI 模型、功能开关等通用配置",
  notifications: "管理系统通知偏好和推送方式",
  logs: "查看应用运行日志和诊断信息",
  router: "配置 LLM Judge 智能路由和模型分级策略",
  soul: "定义 AI 助手的人设和对话风格",
  user: "设置用户身份信息，用于个性化对话",
  memory: "管理持久化记忆和上下文信息",
  apikeys: "创建和管理 API 访问密钥",
  "trusted-workspaces": "管理可信任的工作区目录",
  "custom-rules": "配置自定义安全规则和约束",
  permissions: "管理权限策略和访问控制",
  oauth: "配置 OAuth 第三方登录认证",
  "security-dashboard": "安全状态概览和风险评估",
  voice: "配置语音唤醒、识别和合成功能",
  "data-dir": "配置数据文件和附件的存储位置",
  ingest: "配置知识库摄入规则和来源",
  cost: "查看 API 调用成本和用量统计",
  sandbox: "管理代码执行沙箱和安全策略",
};

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

      {/* ── 右侧主内容区（居中显示）── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800">
        {/* 当前页面标题栏 */}
        <div className="sticky top-0 z-10 px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {t("settings.title")}
            <span className="mx-1.5 text-gray-300 dark:text-gray-600">/</span>
            <span className="text-gray-900 dark:text-gray-100">
              {(() => {
                for (const group of NAV_GROUPS) {
                  const item = group.items.find((i) => i.id === activeNav);
                  if (item) return t(item.labelKey as any);
                }
                return "";
              })()}
            </span>
          </h2>
        </div>
        <div className="max-w-4xl mx-auto">
          {/* 页面标题 */}
          {(() => {
            for (const group of NAV_GROUPS) {
              const item = group.items.find((i) => i.id === activeNav);
              if (item) {
                return (
                  <div className="px-6 pt-6 pb-4">
                    <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                      {t(item.labelKey as any)}
                    </h1>
                    {(() => {
                      const desc = PAGE_DESCRIPTIONS[activeNav];
                      return desc ? (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                          {desc}
                        </p>
                      ) : null;
                    })()}
                  </div>
                );
              }
            }
            return null;
          })()}
          {renderContent()}
        </div>
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
            <AppearancePanel
              isDark={isDark}
              config={config}
              setConfig={setConfig}
              toggleTheme={toggleTheme}
              collapsible
            />
            <BackendServicePanel
              isDark={isDark}
              backendStatus={backendStatus}
              backendPort={backendPort}
              setBackendPort={setBackendPort}
              handleSavePort={handleSavePort}
              portSaved={portSaved}
              error={error}
              loading={loading}
              handleStopBackend={handleStopBackend}
              handleStartBackend={handleStartBackend}
              checkBackendStatus={checkBackendStatus}
              collapsible
            />
            <AIConfigPanel
              isDark={isDark}
              collapsible
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
              collapsible
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
              collapsible
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
              collapsible
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
              collapsible
              notifications={
                ((config.notifications as Record<string, unknown>) || {
                  preferredChannel: "auto",
                  idleThresholdMs: 60000,
                  taskCompleteEnabled: true,
                  inputNeededEnabled: true,
                  agentPushEnabled: true,
                  dndEnabled: false,
                  dndStartHour: 22,
                  dndEndHour: 8,
                  categoryBadges: {
                    approval: true,
                    todo: true,
                    system: true,
                    mention: true,
                  },
                  desktopNotifyMinUnread: 1,
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
                dndEnabled: false,
                dndStartHour: 22,
                dndEndHour: 8,
                categoryBadges: {
                  approval: true,
                  todo: true,
                  system: true,
                  mention: true,
                },
                desktopNotifyMinUnread: 1,
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
        return (
          <div className="p-6">
            <LogViewerPage />
          </div>
        );
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
        return (
          <div className="p-6">
            <SecurityDashboard />
          </div>
        );
      case "voice":
        return <VoiceSettings isDark={isDark} />;
      case "data-dir":
        return (
          <DataStoragePanel
            isDark={isDark}
            configuredDirectory={configuredDirectory}
            defaultDirectory={defaultDirectory}
            dataDirectory={dataDirectory}
            envLiriHome={envLiriHome}
            envLiriDataDir={envLiriDataDir}
            setDataDirectory={setDataDirectory}
            dataDirError={dataDirError}
            dataDirSaved={dataDirSaved}
            migrateData={migrateData}
            setMigrateData={setMigrateData}
            migrating={migrating}
            migrationResult={migrationResult}
            handleSaveDataDirectory={handleSaveDataDirectory}
            handleResetDataDirectory={handleResetDataDirectory}
          />
        );
      case "ingest":
        return <KnowledgeIngestPanel isDark={isDark} />;
      case "cost":
        return <CostStatisticsContent isDark={isDark} />;
      case "sandbox":
        return <SandboxManagementContent isDark={isDark} />;
      case "memory":
        return (
          <div className="p-6">
            <MemoryPage />
          </div>
        );
      default:
        return null;
    }
  }
}

/* ── 新增内容组件 ── */

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
    <div>
      <ConfigSection isDark={isDark}>
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
  return (
    <div className="p-6">
      <PermissionPage />
    </div>
  );
}

/** OAuth 认证管理内容 */
function OAuthManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <OAuthPage />
    </div>
  );
}

/** 成本统计内容 */
function CostStatisticsContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <UsageCenterPage />
    </div>
  );
}

/** 沙箱管理内容 */
function SandboxManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <SandboxPage />
    </div>
  );
}

export default SettingsPage;
