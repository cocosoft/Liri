import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/configStore";
import AIConfigPanel from "../settings/AIConfigPanel";
import FeatureFlagsPanel from "../settings/FeatureFlagsPanel";
import NotificationsPanel from "../settings/NotificationsPanel";
import LocalAgentPanel from "../settings/LocalAgentPanel";
import AutoUpdatePanel from "../settings/AutoUpdatePanel";

type ConfigTab = "ai" | "features" | "notifications" | "agent" | "updates";

function ConfigDeepPage() {
  const { config, loadConfig, setConfig } = useConfigStore();
  const isDark = config.theme === "dark";

  const [activeTab, setActiveTab] = useState<ConfigTab>("ai");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async (key: string, value: unknown) => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      await setConfig(key, value);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: ConfigTab; label: string }[] = [
    { key: "ai", label: "AI 配置" },
    { key: "features", label: "功能开关" },
    { key: "notifications", label: "通知" },
    { key: "agent", label: "本地 Agent" },
    { key: "updates", label: "自动更新" },
  ];

  const aiConfig =
    (config.ai as {
      provider?: string;
      model?: string;
      deepseek?: { apiKey?: string; baseUrl?: string; model?: string };
      anthropic?: { apiKey?: string; baseUrl?: string; model?: string };
      openai?: { apiKey?: string; baseUrl?: string; model?: string };
    }) || {};

  const features = (config.features as {
    autoCompact: boolean;
    showTurnDuration: boolean;
    fileCheckpointing: boolean;
    terminalProgressBar: boolean;
    showStatusInTerminalTab: boolean;
    respectGitignore: boolean;
    copyFullResponse: boolean;
    todoEnabled: boolean;
    showExpandedTodos: boolean;
  }) || {
    autoCompact: false,
    showTurnDuration: false,
    fileCheckpointing: false,
    terminalProgressBar: false,
    showStatusInTerminalTab: false,
    respectGitignore: true,
    copyFullResponse: false,
    todoEnabled: true,
    showExpandedTodos: false,
  };

  const notifications = (config.notifications as {
    preferredChannel: "auto" | "native" | "none";
    idleThresholdMs: number;
    taskCompleteEnabled: boolean;
    inputNeededEnabled: boolean;
    agentPushEnabled: boolean;
  }) || {
    preferredChannel: "auto",
    idleThresholdMs: 60000,
    taskCompleteEnabled: true,
    inputNeededEnabled: true,
    agentPushEnabled: true,
  };

  const localAgent = (config.localAgent as {
    enabled: boolean;
    routing: {
      strategy: "cloud-first" | "ollama-first" | "local-first";
      fallbackToCloud: boolean;
    };
    bypassRoutes?: string[];
    enableMetrics?: boolean;
  }) || {
    enabled: false,
    routing: { strategy: "cloud-first", fallbackToCloud: true },
    bypassRoutes: [],
    enableMetrics: false,
  };

  const autoUpdate = (config.autoUpdate as {
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
  };

  return (
    <div
      className={`flex-1 overflow-hidden flex flex-col ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      <div className="max-w-5xl mx-auto w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1
              className={`text-2xl font-bold ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              深度配置
            </h1>
            <p
              className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              高级配置选项，请谨慎修改
            </p>
          </div>
          {saveStatus !== "idle" && (
            <span
              className={`px-3 py-1 text-sm rounded-full ${
                saveStatus === "success"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {saving
                ? "保存中..."
                : saveStatus === "success"
                  ? "已保存"
                  : "保存失败"}
            </span>
          )}
        </div>

        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-500 text-blue-500"
                  : isDark
                    ? "border-transparent text-gray-400 hover:text-gray-300"
                    : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {activeTab === "ai" && (
            <AIConfigPanel
              isDark={isDark}
              config={aiConfig}
              onUpdate={(updates) =>
                handleSave("ai", { ...aiConfig, ...updates })
              }
            />
          )}

          {activeTab === "features" && (
            <FeatureFlagsPanel
              isDark={isDark}
              features={features}
              onUpdate={(updates) =>
                handleSave("features", { ...features, ...updates })
              }
            />
          )}

          {activeTab === "notifications" && (
            <NotificationsPanel
              isDark={isDark}
              notifications={notifications}
              onUpdate={(updates) =>
                handleSave("notifications", { ...notifications, ...updates })
              }
            />
          )}

          {activeTab === "agent" && (
            <LocalAgentPanel
              isDark={isDark}
              localAgent={localAgent}
              ollama={
                config.localOllama as
                  | {
                      enabled: boolean;
                      baseUrl: string;
                      defaultModel: string;
                      timeout: number;
                    }
                  | undefined
              }
              onUpdateLocalAgent={(updates) =>
                handleSave("localAgent", { ...localAgent, ...updates })
              }
              onUpdateOllama={(updates) =>
                handleSave("localOllama", {
                  ...(config.localOllama || {}),
                  ...updates,
                })
              }
            />
          )}

          {activeTab === "updates" && (
            <AutoUpdatePanel
              isDark={isDark}
              autoUpdate={autoUpdate}
              onUpdate={(updates) =>
                handleSave("autoUpdate", { ...autoUpdate, ...updates })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfigDeepPage;
