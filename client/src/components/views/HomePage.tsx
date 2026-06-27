import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBackendStore } from "../../stores/backendStore";
import { ChatIcon, KnowledgeIcon, GaugeIcon, DashboardIcon, TaskIcon, CronIcon, FileIcon, DevIcon, SettingsIcon } from "../../assets/icons";
import type { BaseIconProps } from "../../assets/icons";

interface NavCardProps {
  icon: React.ComponentType<BaseIconProps>;
  title: string;
  description: string;
  path: string;
}

function NavCard({ icon: IconComponent, title, description, path }: NavCardProps) {
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

function HomePage() {
  const { t } = useTranslation();
  const { status, startBackend, stopBackend, error } = useBackendStore();
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(false);

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
              <div className={`w-3 h-3 rounded-full ${status.running ? "bg-green-500" : "bg-red-500"}`} />
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

        {/* 常用功能网格 */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
          {t("common.commonFunctions")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <NavCard
            icon={ChatIcon}
            title={t("home.card.chat")}
            description={t("home.card.chatDesc")}
            path="/chat"
          />
          <NavCard
            icon={KnowledgeIcon}
            title={t("home.card.knowledge")}
            description={t("home.card.knowledgeDesc")}
            path="/knowledge"
          />
          <NavCard
            icon={GaugeIcon}
            title={t("home.card.cost")}
            description={t("home.card.costDesc")}
            path="/cost"
          />
          <NavCard
            icon={DashboardIcon}
            title={t("home.card.dashboard")}
            description={t("home.card.dashboardDesc")}
            path="/dashboard"
          />
          <NavCard
            icon={TaskIcon}
            title={t("home.card.tasks")}
            description={t("home.card.tasksDesc")}
            path="/tasks"
          />
          <NavCard
            icon={CronIcon}
            title={t("home.card.cron")}
            description={t("home.card.cronDesc")}
            path="/cron"
          />
          <NavCard
            icon={FileIcon}
            title={t("home.card.files")}
            description={t("home.card.filesDesc")}
            path="/files"
          />
          <NavCard
            icon={DevIcon}
            title={t("home.card.terminal")}
            description={t("home.card.terminalDesc")}
            path="/terminal"
          />
          <NavCard
            icon={GaugeIcon}
            title={t("home.card.monitor")}
            description={t("home.card.monitorDesc")}
            path="/monitor"
          />
          <NavCard
            icon={SettingsIcon}
            title={t("home.card.settings")}
            description={t("home.card.settingsDesc")}
            path="/settings"
          />
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
