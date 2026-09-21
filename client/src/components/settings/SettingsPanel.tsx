/**
 * SettingsPanel — Settings 侧边面板（A3 高频快捷抽屉）
 *
 * 右侧滑出抽屉，App 层挂载：任意页面可开、不离开当前页（保留对话上下文）。
 * 高频 tab：外观 / 智能路由 / 记忆 / 通知；底部「打开完整设置」跳 /settings。
 * 全量设置仍保留 /settings 独立路由。
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import {
  useSettingsPanelStore,
  type SettingsPanelTab,
} from "../../stores/settingsPanelStore";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import AppearancePanel from "./AppearancePanel";
import RouterConfigPanel from "./RouterConfigPanel";
import MemorySummaryPanel from "./MemorySummaryPanel";
import NotificationsPanel from "./NotificationsPanel";

function SettingsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const panelOpen = useSettingsPanelStore((s) => s.panelOpen);
  const activeTab = useSettingsPanelStore((s) => s.activeTab);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);
  const setActiveTab = useSettingsPanelStore((s) => s.setActiveTab);

  const config = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const isDark = config.theme === "dark";
  const toggleTheme = () => setConfig("theme", isDark ? "light" : "dark");

  // ESC 关闭（仿 NotificationPanel）
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    if (panelOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelOpen, closePanel]);

  if (!panelOpen) return null;

  // 通知配置（读取模式同 SettingsPage）
  const notifications = ((config.notifications as Record<string, unknown>) || {
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
  }) as unknown as Parameters<typeof NotificationsPanel>[0]["notifications"];

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={closePanel}
      />

      {/* 面板 */}
      <div
        className="fixed right-0 top-0 bottom-0 w-[420px] max-w-[100vw] bg-white dark:bg-gray-900 shadow-2xl z-[60] flex flex-col"
        style={{ animation: "slideIn 300ms cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            {t("nav.settings")}
          </h2>
          <button
            onClick={closePanel}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            aria-label={t("common.close")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* tablist（复用 ui/tabs.tsx，受控） */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(String(v) as SettingsPanelTab)}
          className="flex-1 min-h-0"
        >
          <div className="px-3 pt-2 border-b border-gray-100 dark:border-gray-800">
            <TabsList variant="line" className="w-full">
              <TabsTrigger value="config">
                {t("settings.generalConfig")}
              </TabsTrigger>
              <TabsTrigger value="router">{t("settings.router")}</TabsTrigger>
              <TabsTrigger value="memory">{t("settings.memory")}</TabsTrigger>
              <TabsTrigger value="notifications">
                {t("settings.notifications")}
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <TabsContent value="config">
              <AppearancePanel
                isDark={isDark}
                config={config}
                setConfig={setConfig}
                toggleTheme={toggleTheme}
              />
            </TabsContent>
            <TabsContent value="router">
              <RouterConfigPanel
                isDark={isDark}
                config={config}
                setConfig={setConfig}
              />
            </TabsContent>
            <TabsContent value="memory">
              <MemorySummaryPanel />
            </TabsContent>
            <TabsContent value="notifications">
              <NotificationsPanel
                isDark={isDark}
                notifications={notifications}
                onUpdate={(u) =>
                  setConfig("notifications", { ...notifications, ...u })
                }
              />
            </TabsContent>
          </div>
        </Tabs>

        {/* 底部：打开完整设置 */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => {
              navigate("/settings");
              closePanel();
            }}
            className="w-full text-center px-2 py-2 rounded text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800"
          >
            {t("settings.openFullSettings")} →
          </button>
        </div>
      </div>
    </>
  );
}

export default SettingsPanel;
