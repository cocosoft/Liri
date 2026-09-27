import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import { configService } from "../../services/configService";
import { handleClientError } from "../../utils/handleError";
import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
  SelectConfig,
  TextConfig,
} from "./ConfigComponents";

/** PDCA 审查门配置（与后端 ReviewGateConfig 对齐，经 config.json 的 pdca.review.gate 持久化） */
export interface PDCAReviewConfig {
  mode: "default" | "disabled" | "lenient" | "strict";
  /** 分数阈值（0-100），0 = 不启用分数门槛 */
  passThreshold: number;
  /** 机械验证开关（verifyProject） */
  enableMechanicalVerify: boolean;
  /** VerifierAgent 双指标验证开关 */
  enableVerifier: boolean;
}

const DEFAULT_CONFIG: PDCAReviewConfig = {
  mode: "default",
  passThreshold: 0,
  enableMechanicalVerify: true,
  enableVerifier: true,
};

const MODE_OPTIONS: { value: PDCAReviewConfig["mode"]; labelKey: string }[] = [
  { value: "default", labelKey: "settings.pdcaModeDefault" },
  { value: "lenient", labelKey: "settings.pdcaModeLenient" },
  { value: "strict", labelKey: "settings.pdcaModeStrict" },
  { value: "disabled", labelKey: "settings.pdcaModeDisabled" },
];

function PDCAReviewSettingsPanel() {
  const { t } = useTranslation();
  const isDark = useConfigStore((s) => s.config.theme) === "dark";
  const [cfg, setCfg] = useState<PDCAReviewConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    configService
      .get("pdca.review.gate")
      .then((v) => {
        if (v && typeof v === "object") {
          setCfg({ ...DEFAULT_CONFIG, ...(v as PDCAReviewConfig) });
        }
      })
      .catch((e) =>
        handleClientError(e, {
          module: "settings:PDCAReview",
          action: "load",
        }),
      )
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await configService.set("pdca.review.gate", cfg);
      setSavedAt(Date.now());
    } catch (e) {
      handleClientError(e, {
        module: "settings:PDCAReview",
        action: "save",
      });
    } finally {
      setSaving(false);
    }
  };

  const disabled = cfg.mode === "disabled";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <ConfigSection
        title={t("settings.pdcaReview")}
        description={t("settings.pdcaReviewDesc")}
        isDark={isDark}
      >
        {!loaded ? (
          <div className="py-4 text-sm text-gray-400 dark:text-gray-500">
            {t("common.loading")}
          </div>
        ) : (
          <>
            <ConfigItem
              label={t("settings.pdcaMode")}
              description={t("settings.pdcaModeDesc")}
              isDark={isDark}
            >
              <SelectConfig
                isDark={isDark}
                value={cfg.mode}
                onChange={(mode) =>
                  setCfg({ ...cfg, mode: mode as PDCAReviewConfig["mode"] })
                }
                options={MODE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: t(o.labelKey),
                }))}
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.pdcaThreshold")}
              description={t("settings.pdcaThresholdDesc")}
              isDark={isDark}
            >
              <TextConfig
                isDark={isDark}
                type="number"
                value={String(cfg.passThreshold)}
                onChange={(v) =>
                  setCfg({
                    ...cfg,
                    passThreshold: Math.max(0, Math.min(100, Number(v) || 0)),
                  })
                }
                disabled={disabled}
                className="w-24"
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.pdcaMechanicalVerify")}
              description={t("settings.pdcaMechanicalVerifyDesc")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={cfg.enableMechanicalVerify}
                onChange={(enableMechanicalVerify) =>
                  setCfg({ ...cfg, enableMechanicalVerify })
                }
                disabled={disabled}
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.pdcaVerifier")}
              description={t("settings.pdcaVerifierDesc")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={cfg.enableVerifier}
                onChange={(enableVerifier) =>
                  setCfg({ ...cfg, enableVerifier })
                }
                disabled={disabled}
              />
            </ConfigItem>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
              >
                {saving ? t("settings.saving") : t("common.save")}
              </button>
              {savedAt && (
                <span className="text-xs text-green-500 dark:text-green-400">
                  {t("settings.savedAt", {
                    time: new Date(savedAt).toLocaleTimeString(),
                  })}
                </span>
              )}
            </div>
          </>
        )}
      </ConfigSection>
    </div>
  );
}

export default PDCAReviewSettingsPanel;
