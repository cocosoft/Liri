/**
 * 渠道设置子组件
 * 管理网关和外部平台渠道（QQ/Discord/Telegram 等）的启用/禁用
 */

import React from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import { SettingRow } from './SettingRow';

/**
 * 开关按钮
 */
const Toggle: React.FC<{
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    className={`relative w-11 h-6 rounded-full transition-colors ${
      value ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
    }`}
  >
    <span
      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
        value ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

/**
 * 渠道列表配置
 */
const CHANNEL_ITEMS: { key: string; label: string; desc: string }[] = [
  { key: 'qq', label: 'QQ Bot', desc: '通过 QQ 机器人接收和回复消息' },
  { key: 'discord', label: 'Discord', desc: '通过 Discord Bot 接入' },
  { key: 'telegram', label: 'Telegram', desc: '通过 Telegram Bot 接入' },
  { key: 'dingtalk', label: '钉钉', desc: '通过钉钉机器人接入' },
  { key: 'feishu', label: '飞书', desc: '通过飞书应用接入' },
  { key: 'wechat', label: '微信', desc: '通过企业微信接入' },
];

/**
 * 渠道设置面板
 */
export const ChannelSettings: React.FC = () => {
  const { settings, update } = useSettings();

  const channels = settings.channels || {};
  const gateway = channels.gateway || {};

  /**
   * 更新网关开关
   */
  const handleGatewayChange = (enabled: boolean) => {
    update({
      channels: {
        ...channels,
        gateway: { ...gateway, enabled },
      },
    });
  };

  /**
   * 更新单个渠道开关
   */
  const handleChannelChange = (channelKey: string, enabled: boolean) => {
    update({
      channels: {
        ...channels,
        [channelKey]: { enabled },
      },
    });
  };

  return (
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* 网关总开关 */}
      <SettingRow label="网关服务" hint="总开关，关闭后所有外部渠道均不可用">
        <Toggle
          value={gateway.enabled === true}
          onChange={handleGatewayChange}
        />
      </SettingRow>

      {/* 各渠道开关 */}
      {CHANNEL_ITEMS.map((ch) => {
        const channel =
          (channels as unknown as Record<string, { enabled?: boolean }>)[
            ch.key
          ] || {};
        return (
          <SettingRow key={ch.key} label={ch.label} hint={ch.desc}>
            <Toggle
              value={channel.enabled === true}
              onChange={(v) => handleChannelChange(ch.key, v)}
            />
          </SettingRow>
        );
      })}
    </div>
  );
};
