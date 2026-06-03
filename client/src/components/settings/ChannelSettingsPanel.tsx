import { ConfigSection, ConfigItem, ToggleConfig } from "./ConfigComponents";

const CHANNEL_LIST: { key: string; label: string; description: string }[] = [
  { key: "qq", label: "QQ Bot", description: "通过 QQ 机器人接收和回复消息" },
  { key: "discord", label: "Discord", description: "通过 Discord Bot 接入" },
  { key: "telegram", label: "Telegram", description: "通过 Telegram Bot 接入" },
  { key: "dingtalk", label: "钉钉", description: "通过钉钉机器人接入" },
  { key: "feishu", label: "飞书", description: "通过飞书应用接入" },
  { key: "wechat", label: "微信", description: "通过企业微信接入" },
];

interface ChannelItem {
  enabled?: boolean;
}

interface ChannelsConfig {
  gateway?: { enabled?: boolean };
  qq?: ChannelItem;
  discord?: ChannelItem;
  telegram?: ChannelItem;
  dingtalk?: ChannelItem;
  feishu?: ChannelItem;
  wechat?: ChannelItem;
}

interface ChannelSettingsPanelProps {
  isDark: boolean;
  channels: ChannelsConfig;
  onUpdate: (updates: Partial<ChannelsConfig>) => void;
}

/**
 * 渠道设置面板
 * 管理网关和各平台的启用状态
 */
function ChannelSettingsPanel({
  isDark,
  channels,
  onUpdate,
}: ChannelSettingsPanelProps) {
  const gatewayEnabled = channels.gateway?.enabled === true;

  return (
    <ConfigSection
      title="渠道设置"
      description="管理外部消息渠道的启用状态，网关总开关控制所有渠道"
      isDark={isDark}
    >
      <div className="space-y-4">
        {/* 网关总开关 */}
        <ConfigItem
          label="网关服务"
          description="总开关，关闭后所有外部渠道均不可用"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={gatewayEnabled}
            onChange={(checked) =>
              onUpdate({ gateway: { ...channels.gateway, enabled: checked } })
            }
          />
        </ConfigItem>

        <div className={`h-px ${isDark ? "bg-gray-700" : "bg-gray-200"}`} />

        {/* 各平台开关 */}
        {CHANNEL_LIST.map((ch) => {
          const channel =
            (channels as Record<string, ChannelItem | undefined>)[ch.key] || {};
          return (
            <ConfigItem
              key={ch.key}
              label={ch.label}
              description={ch.description}
              isDark={isDark}
            >
              <ToggleConfig
                isDark={isDark}
                checked={channel.enabled === true}
                onChange={(checked) =>
                  onUpdate({
                    [ch.key]: { enabled: checked },
                  } as Partial<ChannelsConfig>)
                }
              />
            </ConfigItem>
          );
        })}
      </div>
    </ConfigSection>
  );
}

export default ChannelSettingsPanel;
