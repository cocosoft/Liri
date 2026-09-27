/**
 * OfficeProjectSettingsPanel — 办公/项目设置面板（设置模块「办公」项）
 *
 * 统一展示办公相关配置与状态：
 * - OfficeCLI 状态卡片（未安装 / 已安装（版本）/ 版本不兼容）+ 一键安装
 * - 协作式文档生成开关（docWorkflow.staged）
 * - 协商式执行引擎开关 + 门控强度（negotiation.enabled + tier）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
  SelectConfig,
} from "./ConfigComponents";
import { officeService } from "../../services/officeService";
import { useConfigStore } from "../../stores/configStore";
import { handleClientError } from "../../utils/handleError";
import type { OfficeCliInstallStatus } from "../../types/office";

interface OfficeProjectSettingsPanelProps {
  isDark: boolean;
}

function OfficeProjectSettingsPanel({
  isDark,
}: OfficeProjectSettingsPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OfficeCliInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 协作配置
  const { config, setConfig } = useConfigStore();
  const docWorkflow = (config.docWorkflow ?? {
    staged: true,
    defaultFormat: "docx",
    imageConcurrency: 3,
    outlineConfirmTimeoutMs: 0,
    degradeOnImageFailure: true,
  }) as {
    staged: boolean;
    defaultFormat: string;
    imageConcurrency: number;
    outlineConfirmTimeoutMs: number;
    degradeOnImageFailure: boolean;
  };
  const negotiation = (config.negotiation ?? {
    enabled: true,
    tier: "moderate",
    responseTimeoutMs: 300000,
    autoDegradeOnTimeout: true,
  }) as {
    enabled: boolean;
    tier: string;
    responseTimeoutMs: number;
    autoDegradeOnTimeout: boolean;
  };

  const updateDocWorkflow = (key: string, value: unknown) => {
    void setConfig("docWorkflow", { ...docWorkflow, [key]: value });
  };
  const updateNegotiation = (key: string, value: unknown) => {
    void setConfig("negotiation", { ...negotiation, [key]: value });
  };

  const loadStatus = useCallback(async () => {
    try {
      const res = await officeService.getOfficeCLIStatus();
      const data = (
        res as unknown as { data?: { data?: OfficeCliInstallStatus } }
      )?.data?.data as unknown as OfficeCliInstallStatus | undefined;
      setStatus(data ?? null);
    } catch (e) {
      handleClientError(e, {
        module: "settings:office",
        action: "load_status",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loadStatus]);

  useEffect(() => {
    if (status?.state === "running") {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          void loadStatus();
        }, 2000);
      }
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [status?.state, loadStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await officeService.installOfficeCLI();
      await loadStatus();
    } catch (e) {
      handleClientError(e, { module: "settings:office", action: "install" });
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div className={`p-6 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
        {t("office.officeCliLoading")}
      </div>
    );
  }

  const info = status?.info;
  const state = status?.state ?? "idle";
  const installed = !!info?.installed && !info?.incompatible;

  const badge =
    state === "running"
      ? {
          text: t("office.officeCliInstalling"),
          cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        }
      : installed
        ? {
            text: t("office.officeCliReady"),
            cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
          }
        : info?.incompatible
          ? {
              text: t("office.officeCliIncompatible"),
              cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
            }
          : {
              text: t("office.officeCliNotInstalled"),
              cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
            };

  return (
    <>
      {/* OfficeCLI 安装管理 */}
      <ConfigSection
        title={t("office.officeCliTitle")}
        description={t("office.officeCliDesc")}
        isDark={isDark}
      >
        <ConfigItem
          label="OfficeCLI"
          description={
            info?.installed
              ? t("office.officeCliVersionInfo", {
                  version: info.version ?? t("office.officeCliVersionUnknown"),
                  incompatibleSuffix: info.incompatible
                    ? t("office.officeCliVersionIncompatibleSuffix")
                    : "",
                  path: info.path ?? t("office.officeCliSystemPath"),
                })
              : t("office.officeCliNotInstalledDesc")
          }
          isDark={isDark}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${badge.cls}`}
            >
              {badge.text}
            </span>
            {!installed && (
              <button
                onClick={() => void handleInstall()}
                disabled={state === "running" || installing}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  isDark
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                {state === "running" || installing
                  ? t("office.officeCliInstalling")
                  : t("office.officeCliInstall")}
              </button>
            )}
          </div>
          {state === "failed" && status?.error && (
            <p
              className={`mt-2 text-xs ${isDark ? "text-red-400" : "text-red-600"}`}
            >
              {t("office.officeCliInstallFailed", { error: status.error })}
            </p>
          )}
          {status?.constraint && info?.incompatible && (
            <p
              className={`mt-2 text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}
            >
              {t("office.officeCliVersionRange", {
                min: status.constraint.minVersion,
                max: status.constraint.maxVersion,
                lastTested: status.constraint.lastTested,
              })}
            </p>
          )}
        </ConfigItem>
      </ConfigSection>

      {/* 协作式文档生成 */}
      <ConfigSection
        title={t("office.docStagedTitle")}
        description={t("office.docStagedDesc")}
        isDark={isDark}
      >
        <ConfigItem
          label={t("office.docStaged")}
          description={t("office.docStagedHint")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={docWorkflow.staged}
            onChange={(v) => updateDocWorkflow("staged", v)}
          />
        </ConfigItem>
        <ConfigItem
          label={t("office.docDefaultFormat")}
          description={t("office.docDefaultFormatDesc")}
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={docWorkflow.defaultFormat}
            onChange={(v) => updateDocWorkflow("defaultFormat", v)}
            options={[
              { value: "docx", label: t("office.docFormatDocx") },
              { value: "pptx", label: t("office.docFormatPptx") },
              { value: "html", label: t("office.docFormatHtml") },
              { value: "pdf", label: t("office.docFormatPdf") },
            ]}
          />
        </ConfigItem>
        <ConfigItem
          label={t("office.docDegradeImage")}
          description={t("office.docDegradeImageDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={docWorkflow.degradeOnImageFailure}
            onChange={(v) => updateDocWorkflow("degradeOnImageFailure", v)}
          />
        </ConfigItem>
      </ConfigSection>

      {/* 协商式执行引擎 */}
      <ConfigSection
        title={t("office.negotiationTitle")}
        description={t("office.negotiationDesc")}
        isDark={isDark}
      >
        <ConfigItem
          label={t("office.negotiationEnable")}
          description={t("office.negotiationEnableDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={negotiation.enabled}
            onChange={(v) => updateNegotiation("enabled", v)}
          />
        </ConfigItem>
        <ConfigItem
          label={t("office.negotiationTier")}
          description={t("office.negotiationTierDesc")}
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={negotiation.tier}
            onChange={(v) => updateNegotiation("tier", v)}
            disabled={!negotiation.enabled}
            options={[
              { value: "strict", label: t("office.negotiationTierStrict") },
              { value: "moderate", label: t("office.negotiationTierModerate") },
              { value: "relaxed", label: t("office.negotiationTierRelaxed") },
            ]}
          />
        </ConfigItem>
        <ConfigItem
          label={t("office.negotiationAutoDegrade")}
          description={t("office.negotiationAutoDegradeDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={negotiation.autoDegradeOnTimeout}
            onChange={(v) => updateNegotiation("autoDegradeOnTimeout", v)}
            disabled={!negotiation.enabled}
          />
        </ConfigItem>
      </ConfigSection>
    </>
  );
}

export default OfficeProjectSettingsPanel;
