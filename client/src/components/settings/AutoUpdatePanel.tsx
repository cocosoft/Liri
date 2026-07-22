import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  SelectConfig,
  ToggleConfig,
} from "./ConfigComponents";

interface AutoUpdateConfig {
  enabled: boolean;
  checkIntervalMs: number;
  channel: "stable" | "beta";
  checkOnStartup: boolean;
  verbose: boolean;
}

interface AutoUpdatePanelProps {
  isDark: boolean;
  autoUpdate: AutoUpdateConfig;
  onUpdate: (updates: Partial<AutoUpdateConfig>) => void;
}

function AutoUpdatePanel({
  isDark,
  autoUpdate,
  onUpdate,
}: AutoUpdatePanelProps) {
  const { t } = useTranslation();

  return (
    <ConfigSection
      title={t("settings.autoUpdate")}
      description={t("settings.autoUpdateDesc")}
      isDark={isDark}
    >
      <div className="space-y-4">
        <ConfigItem label={t("settings.autoUpdateEnable")} isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={autoUpdate.enabled}
            onChange={(checked) => onUpdate({ enabled: checked })}
          />
        </ConfigItem>

        {autoUpdate.enabled && (
          <>
            <ConfigItem
              label={t("settings.autoUpdateCheckInterval")}
              isDark={isDark}
            >
              <SelectConfig
                isDark={isDark}
                value={String(autoUpdate.checkIntervalMs)}
                onChange={(value) =>
                  onUpdate({ checkIntervalMs: parseInt(value, 10) })
                }
                options={[
                  {
                    value: "3600000",
                    label: t("settings.autoUpdateInterval1h"),
                  },
                  {
                    value: "14400000",
                    label: t("settings.autoUpdateInterval4h"),
                  },
                  {
                    value: "43200000",
                    label: t("settings.autoUpdateInterval12h"),
                  },
                  {
                    value: "86400000",
                    label: t("settings.autoUpdateInterval24h"),
                  },
                  {
                    value: "604800000",
                    label: t("settings.autoUpdateInterval7d"),
                  },
                ]}
              />
            </ConfigItem>

            <ConfigItem label={t("settings.autoUpdateChannel")} isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={autoUpdate.channel}
                onChange={(value) =>
                  onUpdate({ channel: value as AutoUpdateConfig["channel"] })
                }
                options={[
                  {
                    value: "stable",
                    label: t("settings.autoUpdateChannelStable"),
                  },
                  { value: "beta", label: t("settings.autoUpdateChannelBeta") },
                ]}
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.autoUpdateCheckOnStartup")}
              description={t("settings.autoUpdateCheckOnStartupDesc")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={autoUpdate.checkOnStartup}
                onChange={(checked) => onUpdate({ checkOnStartup: checked })}
              />
            </ConfigItem>

            <ConfigItem
              label={t("settings.autoUpdateVerbose")}
              description={t("settings.autoUpdateVerboseDesc")}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={autoUpdate.verbose}
                onChange={(checked) => onUpdate({ verbose: checked })}
              />
            </ConfigItem>
          </>
        )}
      </div>
    </ConfigSection>
  );
}

export default AutoUpdatePanel;
