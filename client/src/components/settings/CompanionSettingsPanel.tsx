import {
  ConfigSection,
  ConfigItem,
  ToggleConfig,
  TextConfig,
} from "./ConfigComponents";

interface CompanionPanelProps {
  isDark: boolean;
  companion: { name?: string; soul?: string };
  companionMuted?: boolean;
  onUpdateCompanion: (updates: { name?: string; soul?: string }) => void;
  onToggleMuted: (muted: boolean) => void;
}

/**
 * 伙伴设置面板
 * 管理 AI 助手的人设名称、灵魂 Prompt 和静音状态
 */
function CompanionSettingsPanel({
  isDark,
  companion,
  companionMuted,
  onUpdateCompanion,
  onToggleMuted,
}: CompanionPanelProps) {
  return (
    <ConfigSection
      title="伙伴设置"
      description="自定义 AI 助手的显示名称和个性风格"
      isDark={isDark}
    >
      <div className="space-y-4">
        {/* 名称 */}
        <ConfigItem
          label="助手名称"
          description="设置 AI 助手在对话中的显示名称"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            value={companion.name || ""}
            onChange={(value) => onUpdateCompanion({ name: value })}
            placeholder="Liri"
            className="w-48"
          />
        </ConfigItem>

        {/* 灵魂描述 */}
        <ConfigItem
          label="灵魂描述"
          description="定义助手的个性和行为风格（System Prompt）"
          isDark={isDark}
        >
          <textarea
            value={companion.soul || ""}
            onChange={(e) => onUpdateCompanion({ soul: e.target.value })}
            rows={4}
            placeholder="You are a helpful coding assistant..."
            className={`w-full px-3 py-2 text-sm border rounded font-mono resize-y ${
              isDark
                ? "bg-gray-700 border-gray-600 text-white placeholder-gray-500"
                : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
            }`}
          />
        </ConfigItem>

        {/* 静音 */}
        <ConfigItem
          label="静音模式"
          description="关闭 AI 助手的自动发言和推送"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={companionMuted === true}
            onChange={onToggleMuted}
          />
        </ConfigItem>
      </div>
    </ConfigSection>
  );
}

export default CompanionSettingsPanel;
