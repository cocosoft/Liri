import { ConfigSection, ConfigItem, SelectConfig, ToggleConfig } from './ConfigComponents';

interface AutoUpdateConfig {
  enabled: boolean;
  checkIntervalMs: number;
  channel: 'stable' | 'beta';
  checkOnStartup: boolean;
  verbose: boolean;
}

interface AutoUpdatePanelProps {
  isDark: boolean;
  autoUpdate: AutoUpdateConfig;
  onUpdate: (updates: Partial<AutoUpdateConfig>) => void;
}

function AutoUpdatePanel({ isDark, autoUpdate, onUpdate }: AutoUpdatePanelProps) {
  return (
    <ConfigSection
      title="自动更新"
      description="配置软件自动更新行为"
      isDark={isDark}
    >
      <div className="space-y-4">
        <ConfigItem label="启用自动更新" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={autoUpdate.enabled}
            onChange={(checked) => onUpdate({ enabled: checked })}
          />
        </ConfigItem>

        {autoUpdate.enabled && (
          <>
            <ConfigItem label="检查间隔" isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={String(autoUpdate.checkIntervalMs)}
                onChange={(value) => onUpdate({ checkIntervalMs: parseInt(value, 10) })}
                options={[
                  { value: '3600000', label: '1小时' },
                  { value: '14400000', label: '4小时' },
                  { value: '43200000', label: '12小时' },
                  { value: '86400000', label: '24小时' },
                  { value: '604800000', label: '7天' },
                ]}
              />
            </ConfigItem>

            <ConfigItem label="更新通道" isDark={isDark}>
              <SelectConfig
                isDark={isDark}
                value={autoUpdate.channel}
                onChange={(value) => onUpdate({ channel: value as AutoUpdateConfig['channel'] })}
                options={[
                  { value: 'stable', label: '稳定版 (Stable)' },
                  { value: 'beta', label: '测试版 (Beta)' },
                ]}
              />
            </ConfigItem>

            <ConfigItem label="启动时检查" description="应用启动时自动检查更新" isDark={isDark}>
              <ToggleConfig
                isDark={isDark}
                checked={autoUpdate.checkOnStartup}
                onChange={(checked) => onUpdate({ checkOnStartup: checked })}
              />
            </ConfigItem>

            <ConfigItem label="详细日志" description="显示详细的更新检查日志" isDark={isDark}>
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