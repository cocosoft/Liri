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
  const featureList: {
    key: keyof FeatureFlags;
    label: string;
    description: string;
  }[] = [
    {
      key: "autoCompact",
      label: "自动压缩",
      description: "对话过长时自动压缩历史消息",
    },
    {
      key: "showTurnDuration",
      label: "显示回合时长",
      description: "在对话中显示每个回合的响应时间",
    },
    {
      key: "fileCheckpointing",
      label: "文件检查点",
      description: "编辑文件时自动创建检查点",
    },
    {
      key: "terminalProgressBar",
      label: "终端进度条",
      description: "在终端中显示任务进度条",
    },
    {
      key: "showStatusInTerminalTab",
      label: "终端标签状态",
      description: "在终端标签页上显示运行状态",
    },
    {
      key: "respectGitignore",
      label: "尊重 .gitignore",
      description: "文件操作时忽略 .gitignore 中的文件",
    },
    {
      key: "copyFullResponse",
      label: "复制完整响应",
      description: "复制 AI 响应时包含完整内容",
    },
    {
      key: "todoEnabled",
      label: "待办事项",
      description: "启用待办事项功能",
    },
    {
      key: "showExpandedTodos",
      label: "显示展开的待办",
      description: "待办事项默认展开显示",
    },
  ];

  return (
    <ConfigSection
      title="功能开关"
      description="控制各项功能的启用状态"
      isDark={isDark}
    >
      <div className="space-y-2">
        {featureList.map((feature) => (
          <ConfigItem
            key={feature.key}
            label={feature.label}
            description={feature.description}
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
