import { useTranslation } from "react-i18next";
import { ConfigSection, ConfigItem, ToggleConfig } from "./ConfigComponents";

interface FeatureFlags {
  autoCompact: boolean;
  showTurnDuration: boolean;
  fileCheckpointing: boolean;
  terminalProgressBar: boolean;
  showStatusInTerminalTab: boolean;
  respectGitignore: boolean;
  copyFullResponse: boolean;
  todoEnabled: boolean;
  showExpandedTodos: boolean;
}

interface FeatureFlagsPanelProps {
  isDark: boolean;
  features: FeatureFlags;
  onUpdate: (updates: Partial<FeatureFlags>) => void;
}

function FeatureFlagsPanel({
  isDark,
  features,
  onUpdate,
}: FeatureFlagsPanelProps) {
  const { t } = useTranslation();

  const featureList: {
    key: keyof FeatureFlags;
    labelKey: string;
    descriptionKey: string;
  }[] = [
    {
      key: "autoCompact",
      labelKey: "settings.featuresAutoCompact",
      descriptionKey: "settings.featuresAutoCompactDesc",
    },
    {
      key: "showTurnDuration",
      labelKey: "settings.featuresShowTurnDuration",
      descriptionKey: "settings.featuresShowTurnDurationDesc",
    },
    {
      key: "fileCheckpointing",
      labelKey: "settings.featuresFileCheckpointing",
      descriptionKey: "settings.featuresFileCheckpointingDesc",
    },
    {
      key: "terminalProgressBar",
      labelKey: "settings.featuresTerminalProgressBar",
      descriptionKey: "settings.featuresTerminalProgressBarDesc",
    },
    {
      key: "showStatusInTerminalTab",
      labelKey: "settings.featuresShowStatusInTerminalTab",
      descriptionKey: "settings.featuresShowStatusInTerminalTabDesc",
    },
    {
      key: "respectGitignore",
      labelKey: "settings.featuresRespectGitignore",
      descriptionKey: "settings.featuresRespectGitignoreDesc",
    },
    {
      key: "copyFullResponse",
      labelKey: "settings.featuresCopyFullResponse",
      descriptionKey: "settings.featuresCopyFullResponseDesc",
    },
    {
      key: "todoEnabled",
      labelKey: "settings.featuresTodoEnabled",
      descriptionKey: "settings.featuresTodoEnabledDesc",
    },
    {
      key: "showExpandedTodos",
      labelKey: "settings.featuresShowExpandedTodos",
      descriptionKey: "settings.featuresShowExpandedTodosDesc",
    },
  ];

  return (
    <ConfigSection
      title={t("settings.features")}
      description={t("settings.featuresDesc")}
      isDark={isDark}
    >
      <div className="space-y-2">
        {featureList.map((feature) => (
          <ConfigItem
            key={feature.key}
            label={t(feature.labelKey)}
            description={t(feature.descriptionKey)}
            isDark={isDark}
          >
            <ToggleConfig
              isDark={isDark}
              checked={features[feature.key]}
              onChange={(checked) => onUpdate({ [feature.key]: checked })}
            />
          </ConfigItem>
        ))}
      </div>
    </ConfigSection>
  );
}

export default FeatureFlagsPanel;
