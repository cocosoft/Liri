import { ConfigSection, ConfigItem, SelectConfig, ToggleConfig, TextConfig } from './ConfigComponents';

interface NotificationsConfig {
  preferredChannel: 'auto' | 'native' | 'none';
  idleThresholdMs: number;
  taskCompleteEnabled: boolean;
  inputNeededEnabled: boolean;
  agentPushEnabled: boolean;
}

interface NotificationsPanelProps {
  isDark: boolean;
  notifications: NotificationsConfig;
  onUpdate: (updates: Partial<NotificationsConfig>) => void;
}

function NotificationsPanel({ isDark, notifications, onUpdate }: NotificationsPanelProps) {
  return (
    <ConfigSection
      title="通知设置"
      description="配置系统通知偏好"
      isDark={isDark}
    >
      <div className="space-y-4">
        <ConfigItem label="通知渠道" isDark={isDark}>
          <SelectConfig
            isDark={isDark}
            value={notifications.preferredChannel}
            onChange={(value) => onUpdate({ preferredChannel: value as NotificationsConfig['preferredChannel'] })}
            options={[
              { value: 'auto', label: '自动选择' },
              { value: 'native', label: '系统原生' },
              { value: 'none', label: '关闭' },
            ]}
          />
        </ConfigItem>

        <ConfigItem label="空闲阈值" description="超过此时间未响应时发送通知" isDark={isDark}>
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(notifications.idleThresholdMs)}
            onChange={(value) => onUpdate({ idleThresholdMs: parseInt(value, 10) || 60000 })}
            placeholder="60000"
            className="w-32"
          />
        </ConfigItem>

        <div className={`h-px ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />

        <ConfigItem label="任务完成通知" description="任务执行完成时发送通知" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={notifications.taskCompleteEnabled}
            onChange={(checked) => onUpdate({ taskCompleteEnabled: checked })}
          />
        </ConfigItem>

        <ConfigItem label="需要输入通知" description="需要用户输入时发送通知" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={notifications.inputNeededEnabled}
            onChange={(checked) => onUpdate({ inputNeededEnabled: checked })}
          />
        </ConfigItem>

        <ConfigItem label="代理推送通知" description="Agent 推送消息时发送通知" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={notifications.agentPushEnabled}
            onChange={(checked) => onUpdate({ agentPushEnabled: checked })}
          />
        </ConfigItem>
      </div>
    </ConfigSection>
  );
}

export default NotificationsPanel;