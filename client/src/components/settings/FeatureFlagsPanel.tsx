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
  alwaysOn: boolean;
  /** 2026-11-03：自校验 / 多轮精修线路的总门控（后端 `SELF_VERIFY_PATTERN`） */
  selfVerifyPattern: boolean;
  /** 2026-11-03：研究编排（候选生成 + 对抗评审）门控（后端 `COMPETITIVE_STRATEGY`） */
  competitiveStrategy: boolean;
}

interface FeatureFlagsPanelProps {
  isDark: boolean;
  features: FeatureFlags;
  onUpdate: (updates: Partial<FeatureFlags>) => void;
  collapsible?: boolean;
}

function FeatureFlagsPanel({
  isDark,
  features,
  onUpdate,
  collapsible,
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
    {
      key: "alwaysOn",
      labelKey: "settings.featuresAlwaysOn",
      descriptionKey: "settings.featuresAlwaysOnDesc",
    },
    // 2026-11-03：验证线路门控（后端 env `FEATURE_SELF_VERIFY_PATTERN` 优先于本开关）
    {
      key: "selfVerifyPattern",
      labelKey: "settings.featuresSelfVerifyPattern",
      descriptionKey: "settings.featuresSelfVerifyPatternDesc",
    },
    // 2026-11-03（缺口 #3）：研究编排门控（env `FEATURE_COMPETITIVE_STRATEGY` 优先）
    {
      key: "competitiveStrategy",
      labelKey: "settings.featuresCompetitiveStrategy",
      descriptionKey: "settings.featuresCompetitiveStrategyDesc",
    },
  ];

  return (
    <ConfigSection
      title={t("settings.features")}
      description={t("settings.featuresDesc")}
      isDark={isDark}
      collapsible={collapsible}
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
