import { useEffect, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { chatService } from "../../services/chatService";
import { appConfigService } from "../../services/appConfigService";
import { setBackendPort as setBackendUrlPort } from "../../services/backendUrl";
import { http } from "../../services/httpClient";
import AIConfigPanel from "../settings/AIConfigPanel";
import AutoUpdatePanel from "../settings/AutoUpdatePanel";
import FeatureFlagsPanel from "../settings/FeatureFlagsPanel";
import LocalAgentPanel from "../settings/LocalAgentPanel";
import NotificationsPanel from "../settings/NotificationsPanel";
import TrustedWorkspacesPanel from "../settings/TrustedWorkspacesPanel";
import CustomRulesPanel from "../settings/CustomRulesPanel";
import VoiceSettings from "../settings/VoiceSettings";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
} from "../settings/ConfigComponents";
import type { BackendStatus } from "../../types";
import { useApiKeyStore } from "../../stores/authStore";
import { routerService } from "../../services/routerService";
import { SettingsIcon, MicIcon, KeyIcon, FolderOpenIcon, BellIcon, ModelIcon, SkillIcon, ShieldIcon, ChannelIcon, McpIcon, DollarIcon, FileIcon, CloudIcon, ZapIcon, PlayIcon, LinkIcon, ImageIcon, SlidersIcon, WrenchIcon } from "../../assets/icons";
import type { BaseIconProps } from "../../assets/icons";

/** 导航项类型 */
interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<BaseIconProps>;
  zone: string;
}

/** 导航分组定义 */
interface NavGroup {
  id: string;
  label: string;
  badgeClass: string;
  items: NavItem[];
}

/** 导航分组配置 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "general",
    label: "通用",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    items: [
      { id: "config", label: "通用配置", icon: SettingsIcon, zone: "general" },
      { id: "notifications", label: "通知设置", icon: BellIcon, zone: "general" },
    ],
  },
  {
    id: "ai",
    label: "模型与 AI",
    badgeClass: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    items: [
      { id: "models", label: "模型管理", icon: ModelIcon, zone: "ai" },
      { id: "skills", label: "技能管理", icon: SkillIcon, zone: "ai" },
      { id: "router", label: "智能路由", icon: SlidersIcon, zone: "ai" },
    ],
  },
  {
    id: "security",
    label: "安全与认证",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    items: [
      { id: "apikeys", label: "API 密钥", icon: KeyIcon, zone: "security" },
      { id: "trusted-workspaces", label: "信任工作区", icon: FolderOpenIcon, zone: "security" },
      { id: "custom-rules", label: "自定义规则", icon: WrenchIcon, zone: "security" },
      { id: "permissions", label: "权限管理", icon: ShieldIcon, zone: "security" },
      { id: "oauth", label: "OAuth 认证", icon: LinkIcon, zone: "security" },
    ],
  },
  {
    id: "integration",
    label: "集成与渠道",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    items: [
      { id: "channels", label: "消息渠道", icon: ChannelIcon, zone: "integration" },
      { id: "voice", label: "语音设置", icon: MicIcon, zone: "integration" },
      { id: "mcp", label: "MCP 市场", icon: McpIcon, zone: "integration" },
      { id: "skill-market", label: "技能市场", icon: CloudIcon, zone: "integration" },
      { id: "autoreply", label: "自动回复", icon: ZapIcon, zone: "integration" },
    ],
  },
  {
    id: "storage",
    label: "存储与成本",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    items: [
      { id: "data-dir", label: "数据目录", icon: FolderOpenIcon, zone: "storage" },
      { id: "files", label: "文件管理", icon: FileIcon, zone: "storage" },
      { id: "cost", label: "成本统计", icon: DollarIcon, zone: "storage" },
      { id: "media", label: "媒体管理", icon: ImageIcon, zone: "storage" },
      { id: "sandbox", label: "沙箱管理", icon: PlayIcon, zone: "storage" },
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
}
interface SetDataDirectoryResponse {
  success: boolean;
  message: string;
  directory: string;
  migration?: { copied: number; skipped: number; errors: string[] };
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
  const [migrationResult, setMigrationResult] = useState<{
    copied: number;
    skipped: number;
    errors: string[];
  } | null>(null);
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
        }, 5000);
      }
    } catch (e: any) {
      setDataDirError(e.response?.data?.error?.message || "保存失败");
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
      if (typeof window !== "undefined" && "__TAURI__" in window) {
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
            设置
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
          <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${group.badgeClass}`}>
            {group.label}
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
              <span className="truncate">{item.label}</span>
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
              onUpdate={(updates) => setConfig("ai", { ...((config.ai as object) || {}), ...updates })}
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
                ((config.ai as Record<string, unknown>)?.localAgent || {
                  enabled: false,
                  routing: {
                    strategy: "cloud-first" as const,
                    fallbackToCloud: true,
                  },
                }) as unknown as Parameters<
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
      case "models":
        return <ModelManagementContent isDark={isDark} />;
      case "skills":
        return <SkillManagementContent isDark={isDark} />;
      case "router":
        return <RouterConfigContent isDark={isDark} config={config} setConfig={setConfig} />;
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
      case "cost":
        return <CostStatisticsContent isDark={isDark} />;
      case "media":
        return <MediaManagementContent isDark={isDark} />;
      case "sandbox":
        return <SandboxManagementContent isDark={isDark} />;
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
    return (
      <ConfigSection title="外观" description="配置界面主题、语言和时区" isDark={isDark}>
        <ConfigItem label="主题模式" description={`当前: ${isDark ? "深色" : "浅色"}`} isDark={isDark}>
          <ToggleConfig isDark={isDark} checked={isDark} onChange={toggleTheme} />
        </ConfigItem>
        <ConfigItem label="界面语言" isDark={isDark}>
          <select
            value={language}
            onChange={(e) => setConfig("language", e.target.value)}
            className="w-full max-w-sm px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
          >
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="ja-JP">日本語</option>
            <option value="ko-KR">한국어</option>
            <option value="fr-FR">Français</option>
            <option value="de-DE">Deutsch</option>
            <option value="es-ES">Español</option>
            <option value="pt-BR">Português (BR)</option>
            <option value="ru-RU">Русский</option>
            <option value="ar-SA">العربية</option>
          </select>
        </ConfigItem>
        <ConfigItem label="时区" isDark={isDark}>
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
    return (
      <ConfigSection title="后端服务" description="管理本地后端服务的运行状态和端口" isDark={isDark}>
        <ConfigItem label="状态" description={backendStatus.running ? `运行中 (端口 ${backendStatus.port})` : "已停止"} isDark={isDark}>
          <span className={`inline-block w-2 h-2 rounded-full ${backendStatus.running ? "bg-green-500" : "bg-red-500"}`} />
        </ConfigItem>
        <ConfigItem label="端口号" isDark={isDark}>
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
              应用端口
            </button>
            {portSaved && <span className="text-xs text-green-500">已保存</span>}
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
              {loading ? "处理中..." : "停止"}
            </button>
          ) : (
            <button
              onClick={handleStartBackend}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "处理中..." : "启动"}
            </button>
          )}
          <button
            onClick={checkBackendStatus}
            className="px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            刷新状态
          </button>
        </div>
      </ConfigSection>
    );
  }

  function renderDataStorage() {
    return (
      <ConfigSection title="数据目录" description="配置数据文件存储位置" isDark={isDark}>
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
        {migrationResult && <MigrationResult result={migrationResult} />}
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleSaveDataDirectory}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
          >
            应用
          </button>
          {configuredDirectory && (
            <button
              onClick={handleResetDataDirectory}
              className="px-3 py-1.5 text-sm rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
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
    try { await deleteApiKey(id); } catch {}
  };

  const handleCopy = async () => {
    if (newKeyValue) {
      try {
        await navigator.clipboard.writeText(newKeyValue);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  };

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">API 密钥管理</h2>
          <p className="mt-1 text-sm text-gray-500">管理您的 API 密钥，用于程序化访问</p>
        </div>
        <button
          onClick={() => { setShowCreateModal(true); setNewKeyValue(null); setNewKeyName(""); setCreateError(null); }}
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
          <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <p className="text-gray-500">暂无 API 密钥</p>
          <p className="mt-1 text-sm text-gray-400">点击上方按钮创建一个新的 API 密钥</p>
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
                  <td className="px-4 py-3 font-mono text-sm">{key.key_prefix}...****</td>
                  <td className="px-4 py-3 text-sm">{formatDate(key.created_at)}</td>
                  <td className="px-4 py-3 text-sm">{key.last_used_at ? formatDate(key.last_used_at) : "从未使用"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(key.id)} className="text-sm text-red-600 dark:text-red-400 hover:underline">
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">密钥已创建</h3>
                <div className="p-3 rounded bg-gray-50 dark:bg-gray-700">
                  <code className="text-sm break-all text-gray-800 dark:text-gray-200">{newKeyValue}</code>
                </div>
                <p className="text-xs text-red-500 mt-2">请立即复制，关闭后将无法再次查看</p>
                <div className="flex gap-2 mt-4">
                  <button onClick={handleCopy} className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                    {copied ? "已复制" : "复制密钥"}
                  </button>
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">创建新密钥</h3>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="密钥名称"
                  className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 mb-4"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={handleCreate} className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                    创建
                  </button>
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
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
  result: { copied: number; skipped: number; errors: string[] };
}) {
  return (
    <div
      className={`p-3 rounded ${result.errors.length > 0 ? "bg-yellow-50 dark:bg-yellow-900/20" : "bg-green-50 dark:bg-green-900/20"}`}
    >
      <p className="text-sm text-gray-700 dark:text-gray-300">
        迁移完成：<span className="font-medium">{result.copied}</span>{" "}
        个已迁移，{result.skipped} 个已跳过
      </p>
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
    </div>
  );
}

/* ── 新增内容组件 ── */

/** 模型管理内容 */
function ModelManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">模型管理</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理 AI 模型配置、切换默认模型、测试模型响应</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/models" className="text-blue-500 hover:underline">模型管理页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 技能管理内容 */
function SkillManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">技能管理</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理已安装技能、配置技能参数、查看技能详情</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/skills" className="text-blue-500 hover:underline">技能管理页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 智能路由配置内容 */
function RouterConfigContent({ 
  isDark, 
  config, 
  setConfig 
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
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">智能路由配置</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">由 LLM Judge 自动分级调度模型</p>
      <ConfigSection title="SmartRouter" description="根据任务复杂度自动选择合适的模型" isDark={isDark}>
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
              Judge 模型: <span className="text-gray-500">使用 LocalAgent 本地模型判定</span>
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
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">权限管理</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理用户权限、信任等级、访问控制</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/permissions" className="text-blue-500 hover:underline">权限管理页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** OAuth 认证管理内容 */
function OAuthManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">OAuth 认证</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理第三方 OAuth 应用授权</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/oauth" className="text-blue-500 hover:underline">OAuth 页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 消息渠道管理内容 */
function ChannelsManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">消息渠道</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理消息推送渠道、配置通知方式</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/channels" className="text-blue-500 hover:underline">消息渠道页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** MCP 市场内容 */
function MCPMarketContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">MCP 市场</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">浏览和安装 MCP 服务器</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/mcp" className="text-blue-500 hover:underline">MCP 市场页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 技能市场内容 */
function SkillMarketContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">技能市场</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">浏览和安装社区技能</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/skill-market" className="text-blue-500 hover:underline">技能市场页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 自动回复管理内容 */
function AutoReplyManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">自动回复</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">配置自动回复规则和触发条件</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/autoreply" className="text-blue-500 hover:underline">自动回复页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 文件管理内容 */
function FileManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">文件管理</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">浏览和管理应用文件</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/files" className="text-blue-500 hover:underline">文件管理页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 成本统计内容 */
function CostStatisticsContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">成本统计</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">查看 API 调用成本、Token 使用量统计</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/cost" className="text-blue-500 hover:underline">成本统计页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 媒体管理内容 */
function MediaManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">媒体管理</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理生成的图片、音频、视频等媒体文件</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/media" className="text-blue-500 hover:underline">媒体管理页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

/** 沙箱管理内容 */
function SandboxManagementContent({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">沙箱管理</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">管理工具执行沙箱环境和安全策略</p>
      <div className="rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          此功能需要跳转到 <a href="/sandbox" className="text-blue-500 hover:underline">沙箱管理页面</a> 进行完整配置。
        </p>
      </div>
    </div>
  );
}

export default SettingsPage;
