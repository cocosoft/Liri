import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { useBackendStore } from "../../stores/backendStore";
import { useRootStore } from "../../stores/root-store";
import { selectEnabledModules } from "../../stores/selectors";
import type { BaseIconProps } from "../../assets/icons";
// §4.3-6：首页卡片元数据来自导航注册表（单一事实来源，门控在派生函数内部完成）
import {
  homeSections,
  toEnabledModuleIds,
  type NavEntry,
} from "../../config/navRegistry";
import { PreviewBadge } from "../common/PreviewBadge";

interface NavCardProps {
  icon: React.ComponentType<BaseIconProps>;
  title: string;
  description: string;
  path: string;
  /** 未完全成熟的新能力：true 时渲染 Preview 角标 */
  preview?: boolean;
}

function NavCard({
  icon: IconComponent,
  title,
  description,
  path,
  preview,
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
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center justify-center gap-1">
        {title}
        {preview && <PreviewBadge />}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
    </button>
  );
}

// §4.3-6：首页两区卡片（功能模块 / 快捷工具）已收敛至 @/config/navRegistry，
// 本组件只做「派生 + 渲染」（模块门控经 selectEnabledModules）。

function HomePage() {
  const { t } = useTranslation();
  const { status, startBackend, stopBackend, error } = useBackendStore();
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(false);

  // §4.3-6：首页两区卡片由 navRegistry 派生（模块门控集合由 selectEnabledModules 派生）
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const enabledModuleIds = useMemo(
    () => toEnabledModuleIds(enabledModules),
    [enabledModules],
  );
  const sections = useMemo(() => {
    return homeSections(enabledModuleIds).map((section) => ({
      id: section.id,
      titleKey: section.titleKey,
      cards: section.items.filter(
        (i): i is NavEntry & { path: string; descKey: string } =>
          Boolean(i.path) && Boolean(i.descKey),
      ),
    }));
  }, [enabledModuleIds]);

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

        {/* 功能模块 / 快捷工具：均由 navRegistry 派生（模块禁用/tier 不可见自动隐藏） */}
        {sections.map((section) => (
          <div key={section.id}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
              {t(section.titleKey)}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {section.cards.map((card) => (
                <NavCard
                  key={card.id}
                  icon={card.icon}
                  title={t(card.labelKey)}
                  description={t(card.descKey)}
                  path={card.path}
                  preview={card.preview}
                />
              ))}
            </div>
          </div>
        ))}

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
