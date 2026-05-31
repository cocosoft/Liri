import { useEffect } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { SkeletonCard } from '../common/Skeleton';

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  qq: 'QQ',
  feishu: '飞书',
  dingtalk: '钉钉',
  wechat: '微信',
  slack: 'Slack',
  discord: 'Discord',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  email: '邮件',
  webhook: 'Webhook',
};

const CHANNEL_TYPE_COLORS: Record<string, string> = {
  qq: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  feishu: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  dingtalk: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  wechat: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  slack: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  discord: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  telegram: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  email: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400',
  webhook: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

function ChannelsPage() {
  const { channels, isLoading, loadChannels, toggleChannel, deleteChannel } = useChannelStore();

  useEffect(() => {
    loadChannels();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          消息渠道
        </h2>

        {isLoading ? (
          <div className="p-4 space-y-3">
            <SkeletonCard count={3} />
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            暂无渠道配置
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${CHANNEL_TYPE_COLORS[channel.type] || ''}`}>
                    {CHANNEL_TYPE_LABELS[channel.type] || channel.type}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {channel.name}
                    </h3>
                    <span
                      className={`text-xs ${
                        channel.connected
                          ? 'text-green-500'
                          : 'text-gray-400'
                      }`}
                    >
                      {channel.connected ? '已连接' : '未连接'}
                    </span>
                    {channel.lastActive && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                        最后活动: {new Date(channel.lastActive).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channel.enabled}
                      onChange={() => toggleChannel(channel.id, !channel.enabled)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                  </label>
                  <button
                    onClick={() => deleteChannel(channel.id)}
                    className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChannelsPage;
