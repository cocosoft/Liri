import { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';

interface ChannelConfig {
  gateway: { enabled: boolean };
  qq: ChannelInboundConfig;
  discord: ChannelInboundConfig;
  telegram: ChannelInboundConfig;
  dingtalk: ChannelInboundConfig;
  feishu: ChannelInboundConfig;
  wechat: ChannelInboundConfig;
}

interface ChannelInboundConfig {
  enabled: boolean;
}

const CHANNEL_INFO: Record<string, { name: string; icon: string; description: string }> = {
  gateway: { name: '网关', icon: '🌐', description: '消息网关总开关' },
  qq: { name: 'QQ', icon: '🐵', description: 'QQ 机器人频道' },
  discord: { name: 'Discord', icon: '🎮', description: 'Discord 机器人频道' },
  telegram: { name: 'Telegram', icon: '✈️', description: 'Telegram 机器人频道' },
  dingtalk: { name: '钉钉', icon: '📌', description: '钉钉机器人频道' },
  feishu: { name: '飞书', icon: '📬', description: '飞书机器人频道' },
  wechat: { name: '微信', icon: '💬', description: '微信机器人频道' },
};

function ChannelsDeepPage() {
  const { config, loadConfig, setConfig } = useConfigStore();
  const isDark = config.theme === 'dark';

  const [channels, setChannels] = useState<ChannelConfig>({
    gateway: { enabled: true },
    qq: { enabled: false },
    discord: { enabled: false },
    telegram: { enabled: false },
    dingtalk: { enabled: false },
    feishu: { enabled: false },
    wechat: { enabled: false },
  });
  const [activeChannel, setActiveChannel] = useState<string>('gateway');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config.channels) {
      setChannels(config.channels as ChannelConfig);
    }
  }, [config]);

  const handleToggle = async (key: keyof ChannelConfig, enabled: boolean) => {
    const newChannels = {
      ...channels,
      [key]: { ...channels[key as keyof ChannelConfig], enabled },
    };
    setChannels(newChannels);
    setSaving(true);
    try {
      await setConfig('channels', newChannels);
    } finally {
      setSaving(false);
    }
  };

  const channelKeys = Object.keys(CHANNEL_INFO);

  return (
    <div className={`flex-1 overflow-hidden flex flex-col ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-5xl mx-auto w-full p-6">
        <div className="mb-6">
          <h1 className={`text-2xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
            通道深度管理
          </h1>
          <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            配置各消息渠道的详细参数
          </p>
        </div>

        <div className={`rounded-lg border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
            {channelKeys.map((key) => {
              const info = CHANNEL_INFO[key];
              const channel = channels[key as keyof ChannelConfig];
              const isEnabled = channel?.enabled ?? false;

              return (
                <button
                  key={key}
                  onClick={() => setActiveChannel(key)}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    activeChannel === key
                      ? isDark
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-blue-500 bg-blue-50'
                      : isDark
                      ? 'border-gray-700 hover:border-gray-600'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`text-2xl mb-1 ${isEnabled ? '' : 'opacity-40'}`}>
                    {info.icon}
                  </div>
                  <div className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                    {info.name}
                  </div>
                  <div className="flex items-center justify-center mt-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isEnabled ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className={`text-lg font-medium ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                  {CHANNEL_INFO[activeChannel]?.name || activeChannel}
                </h2>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {CHANNEL_INFO[activeChannel]?.description}
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {channels[activeChannel as keyof ChannelConfig]?.enabled ? '已启用' : '已禁用'}
                </span>
                <button
                  onClick={() =>
                    handleToggle(
                      activeChannel as keyof ChannelConfig,
                      !channels[activeChannel as keyof ChannelConfig]?.enabled
                    )
                  }
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    channels[activeChannel as keyof ChannelConfig]?.enabled
                      ? 'bg-blue-500'
                      : isDark
                      ? 'bg-gray-600'
                      : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      channels[activeChannel as keyof ChannelConfig]?.enabled
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </label>
            </div>

            {saving && (
              <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                保存中...
              </div>
            )}

            {activeChannel === 'gateway' && (
              <div className={`mt-4 p-4 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  网关是消息系统的核心组件，控制所有渠道的消息路由。
                  禁用网关将导致所有渠道的消息无法收发。
                </p>
              </div>
            )}

            {['qq', 'discord', 'telegram', 'dingtalk', 'feishu', 'wechat'].includes(activeChannel) && (
              <div className={`mt-4 p-4 rounded-lg ${isDark ? 'bg-gray-700/50' : 'bg-gray-50'}`}>
                <h3 className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  渠道配置说明
                </h3>
                <ul className={`text-sm space-y-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  <li>• 请在对应的开放平台创建机器人/应用</li>
                  <li>• 获取 Webhook URL 或 Bot Token 后配置到 PY_APP</li>
                  <li>• 确保机器人已添加到对应的群组或频道</li>
                  <li>• 启用后将自动接收和处理消息</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChannelsDeepPage;