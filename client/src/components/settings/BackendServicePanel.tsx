import { useTranslation } from "react-i18next";
import type { BackendStatus } from "../../types";
import { ConfigSection, ConfigItem } from "./ConfigComponents";

interface BackendServicePanelProps {
  isDark: boolean;
  backendStatus: BackendStatus;
  backendPort: string;
  setBackendPort: (port: string) => void;
  handleSavePort: () => void;
  portSaved: boolean;
  error: string | null;
  loading: boolean;
  handleStopBackend: () => void;
  handleStartBackend: () => void;
  checkBackendStatus: () => void;
  collapsible?: boolean;
}

/** 后端服务管理面板 — 从 SettingsPage.tsx 内联内容提取 */
function BackendServicePanel({
  isDark,
  backendStatus,
  backendPort,
  setBackendPort,
  handleSavePort,
  portSaved,
  error,
  loading,
  handleStopBackend,
  handleStartBackend,
  checkBackendStatus,
  collapsible,
}: BackendServicePanelProps) {
  const { t } = useTranslation();

  const statusText = backendStatus.running
    ? `${t("settings.backendStatusRunning")} (${t("settings.backendPort")} ${backendStatus.port})`
    : t("settings.backendStatusStopped");

  return (
    <ConfigSection
      title={t("settings.backendService")}
      description={t("settings.backendServiceDesc")}
      isDark={isDark}
      collapsible={collapsible}
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

export default BackendServicePanel;
