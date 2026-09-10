import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useBackendStore } from "../../stores/backendStore";
import { useRootStore } from "../../stores/root-store";
import { selectEnabledModules } from "../../stores/selectors";
import {
  ChatIcon,
  KnowledgeIcon,
  GaugeIcon,
  DashboardIcon,
  TaskIcon,
  CronIcon,
  FileIcon,
  DevIcon,
  SettingsIcon,
  ImageIcon,
  OfficeIcon,
  DollarIcon,
} from "../../assets/icons";
import type { BaseIconProps } from "../../assets/icons";

interface NavCardProps {
  icon: React.ComponentType<BaseIconProps>;
  title: string;
  description: string;
  path: string;
}

function NavCard({
  icon: IconComponent,
  title,
  description,
  path,
}: NavCardProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(path)}
      className="group bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-all hover:-translate-y-1 text-center"
    >
      <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
        <IconComponent size={28} className="text-blue-600 dark:text-blue-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
    </button>
  );
}

/**
 * 第一层：模块卡元信息（P1-7：注册表驱动）。
 * moduleId 与 moduleRegistry 一一对应；模块禁用/tier 不可见时卡片自动隐藏。
 */
const MODULE_CARD_META: Record<
  string,
  {
    icon: React.ComponentType<BaseIconProps>;
    titleKey: string;
    descKey: string;
    path: string;
    order: number;
  }
> = {
  chat: {
    icon: ChatIcon,
    titleKey: "home.card.chat",
    descKey: "home.card.chatDesc",
    path: "/chat",
    order: 10,
  },
  project: {
    icon: DashboardIcon,
    titleKey: "home.card.projects",
    descKey: "home.card.projectsDesc",
    path: "/projects",
    order: 20,
  },
  office: {
    icon: OfficeIcon,
    titleKey: "home.card.office",
    descKey: "home.card.officeDesc",
    path: "/office",
    order: 30,
  },
  media: {
    icon: ImageIcon,
    titleKey: "home.card.media",
    descKey: "home.card.mediaDesc",
    path: "/media",
    order: 40,
  },
  knowledge: {
    icon: KnowledgeIcon,
    titleKey: "home.card.knowledge",
    descKey: "home.card.knowledgeDesc",
    path: "/knowledge",
    order: 50,
  },
};

/** 第二层：工具卡（非注册表路由的固定入口；N5：/monitor 死链已移除） */
const TOOL_CARDS: Array<{
  icon: React.ComponentType<BaseIconProps>;
  titleKey: string;
  descKey: string;
  path: string;
}> = [
  {
    icon: TaskIcon,
    titleKey: "home.card.tasks",
    descKey: "home.card.tasksDesc",
    path: "/tasks",
  },
  {
    icon: CronIcon,
    titleKey: "home.card.cron",
    descKey: "home.card.cronDesc",
    path: "/cron",
  },
  {
    icon: GaugeIcon,
    titleKey: "home.card.dashboard",
    descKey: "home.card.dashboardDesc",
    path: "/dashboard",
  },
  {
    icon: DollarIcon,
    titleKey: "home.card.cost",
    descKey: "home.card.costDesc",
    path: "/usage?tab=cost",
  },
  {
    icon: FileIcon,
    titleKey: "home.card.files",
    descKey: "home.card.filesDesc",
    path: "/files",
  },
  {
    icon: DevIcon,
    titleKey: "home.card.terminal",
    descKey: "home.card.terminalDesc",
    path: "/terminal",
  },
  {
    icon: SettingsIcon,
    titleKey: "home.card.settings",
    descKey: "home.card.settingsDesc",
    path: "/settings",
  },
];

function HomePage() {
  const { t } = useTranslation();
  const { status, startBackend, stopBackend, error } = useBackendStore();
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(false);

  // P1-7：模块卡由注册表派生（selectEnabledModules），禁用/tier 隐藏自动生效
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const moduleCards = useMemo(() => {
    return enabledModules
      .map((m) => MODULE_CARD_META[m.id])
      .filter((meta): meta is (typeof MODULE_CARD_META)[string] => !!meta)
      .sort((a, b) => a.order - b.order);
  }, [enabledModules]);

  const getStatusColor = () => {
    if (status.running) return "text-green-600 dark:text-green-400";
    return "text-red-600 dark:text-red-400";
  };

  const handleStart = async () => {
    setActionLoading(true);
    await startBackend();
    setActionLoading(false);
  };

  const handleStop = async () => {
    setActionLoading(true);
    await stopBackend();
    setActionLoading(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 bg-gray-100 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto">
        {/* 欢迎区域 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t("chat.welcomeTitle")}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            {t("common.homeSubtitle")}
          </p>
        </div>

        {/* 状态卡片 */}
        <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${status.running ? "bg-green-500" : "bg-red-500"}`}
              />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("common.backendService")}
                </h3>
                <p className={`text-sm ${getStatusColor()}`}>
                  {status.running ? t("common.running") : t("common.stopped")}
                  {status.running && status.port && ` · 端口 ${status.port}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {status.running ? (
                <button
                  onClick={handleStop}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                >
                  {actionLoading ? t("common.stopping") : t("common.stop")}
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                >
                  {actionLoading ? t("common.starting") : t("common.start")}
                </button>
              )}
              <button
                onClick={() => navigate("/settings")}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors"
              >
                {t("common.advancedSettings")}
              </button>
            </div>
          </div>
          {error && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>

        {/* 第一层：功能模块（注册表驱动，模块禁用/降级时自动隐藏） */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
          {t("home.modulesTitle")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {moduleCards.map((card) => (
            <NavCard
              key={card.path}
              icon={card.icon}
              title={t(card.titleKey)}
              description={t(card.descKey)}
              path={card.path}
            />
          ))}
        </div>

        {/* 第二层：快捷工具（非注册表路由的固定入口） */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
          {t("home.toolsTitle")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {TOOL_CARDS.map((card) => (
            <NavCard
              key={card.path}
              icon={card.icon}
              title={t(card.titleKey)}
              description={t(card.descKey)}
              path={card.path}
            />
          ))}
        </div>

        {/* 快捷提示 */}
        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
          <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
            {t("common.tip")}
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            {t("common.tipText")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
