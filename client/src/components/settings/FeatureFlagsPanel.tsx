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
  /** 2026-11-16：工具披露预算（后端 `TOOL_DISCLOSURE_STRICT`，默认开） */
  toolDisclosureStrict: boolean;
  /** 2026-11-16：多代理 verifier 重试（后端 `SWARM_VERIFY_RETRY`，默认开） */
  swarmVerifyRetry: boolean;
  /** 2026-11-16：重启后计划续跑（后端 `PLAN_STARTUP_RESUME`，默认开） */
  planStartupResume: boolean;
  /** 2026-11-16：计划续跑走系统级执行器（后端 `PLAN_SYSTEM_RESUME`，默认开） */
  planSystemResume: boolean;
  /** 2026-11-16：重启后目标续接（后端 `GOAL_STARTUP_RESUME`，默认开） */
  goalStartupResume: boolean;
  /** 2026-11-21：浏览器自动化（后端 `BROWSER`，默认关；开启后下一轮即可见） */
  browser: boolean;
  /** 2026-11-21：桌面自动化（后端 `COMPUTER_USE`，默认关；每次调用仍需审批） */
  computerUse: boolean;
  /** 2026-11-21（P2）：新增四个能力包开关（后端 `TOOL_PACK_DESKTOP` 等，默认开） */
  toolPackDesktop: boolean;
  toolPackKnowledge: boolean;
  toolPackWeb: boolean;
  toolPackCode: boolean;
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
    // 2026-11-16：翻转后的回退路径（后端默认开，用户可关；env 优先）
    {
      key: "toolDisclosureStrict",
      labelKey: "settings.featuresToolDisclosureStrict",
      descriptionKey: "settings.featuresToolDisclosureStrictDesc",
    },
    {
      key: "swarmVerifyRetry",
      labelKey: "settings.featuresSwarmVerifyRetry",
      descriptionKey: "settings.featuresSwarmVerifyRetryDesc",
    },
    // 2026-11-16：启动期续跑三项（重启后生效；已登记的唤醒在触发前二次校验时同样受本开关约束）
    {
      key: "planStartupResume",
      labelKey: "settings.featuresPlanStartupResume",
      descriptionKey: "settings.featuresPlanStartupResumeDesc",
    },
    {
      key: "planSystemResume",
      labelKey: "settings.featuresPlanSystemResume",
      descriptionKey: "settings.featuresPlanSystemResumeDesc",
    },
    {
      key: "goalStartupResume",
      labelKey: "settings.featuresGoalStartupResume",
      descriptionKey: "settings.featuresGoalStartupResumeDesc",
    },
    // 2026-11-21：两个高风险 GUI 工具（默认关；开启后下一轮即可见，无需重启）
    {
      key: "browser",
      labelKey: "settings.featuresBrowser",
      descriptionKey: "settings.featuresBrowserDesc",
    },
    {
      key: "computerUse",
      labelKey: "settings.featuresComputerUse",
      descriptionKey: "settings.featuresComputerUseDesc",
    },
    // 2026-11-21（工具治理 v3 P2）：新增能力包开关（默认开；关闭后该包工具不再下发，
    // 仍可经 tool_search 检索 —— 与「工具面 minimal」是两层收窄）
    {
      key: "toolPackDesktop",
      labelKey: "settings.featuresToolPackDesktop",
      descriptionKey: "settings.featuresToolPackDesktopDesc",
    },
    {
      key: "toolPackKnowledge",
      labelKey: "settings.featuresToolPackKnowledge",
      descriptionKey: "settings.featuresToolPackKnowledgeDesc",
    },
    {
      key: "toolPackWeb",
      labelKey: "settings.featuresToolPackWeb",
      descriptionKey: "settings.featuresToolPackWebDesc",
    },
    {
      key: "toolPackCode",
      labelKey: "settings.featuresToolPackCode",
      descriptionKey: "settings.featuresToolPackCodeDesc",
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
