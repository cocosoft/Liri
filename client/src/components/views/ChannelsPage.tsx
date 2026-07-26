/**
 * ChannelsPage — 渠道管理主页面
 * Phase 1: 统计面板 + 搜索筛选 + 列表增强
 * Phase 2: 编辑模态框 + 配置按钮 + 删除确认
 * Phase 3: 凭证脱敏 + 插件检测 + 保存/保存并应用
 */

import { useEffect, useMemo } from "react";
import { useChannelStore } from "../../stores/channelStore";
import ChannelStatsPanel from "./ChannelStatsPanel";
import ChannelFilterBar from "./ChannelFilterBar";
import ChannelFormModal from "./ChannelFormModal";
import ConfirmDialog from "../common/ConfirmDialog";
import { SkeletonCard } from "../common/Skeleton";

// ─── 渠道类型颜色映射 ──────────────────────────────────

const CHANNEL_TYPE_COLORS: Record<string, string> = {
  qq: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  feishu: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  dingtalk: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  wechat:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  wecom: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  slack:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  discord:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  telegram: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  whatsapp:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  email: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400",
  webhook:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  line: "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400",
  irc: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400",
  nostr: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  sms: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400",
  matrix: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  facebook: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  twitter: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  mattermost:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  signal:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  googlechat: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  msteams:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  zalo: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  yuanbao: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  bluebubbles:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
  wechat: "微信",
  wecom: "企业微信",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "邮件",
  webhook: "Webhook",
  line: "Line",
  irc: "IRC",
  nostr: "Nostr",
  sms: "短信",
  matrix: "Matrix",
  facebook: "Facebook",
  twitter: "Twitter/X",
  signal: "Signal",
  mattermost: "Mattermost",
  bluebubbles: "iMessage",
  googlechat: "Google Chat",
  msteams: "MS Teams",
  zalo: "Zalo",
  yuanbao: "元宝",
};

// ─── 组件 ──────────────────────────────────────────────

function ChannelsPage() {
  const {
    channels,
    isLoading,
    error,
    filters,
    isRefreshing,
    editingChannel,
    showFormModal,
    confirmDeleteId,
    loadChannels,
    refreshChannels,
    toggleChannel,
    deleteChannel,
    setFilters,
    clearError,
    openEditModal,
    promptDelete,
    cancelDelete,
    getFilteredChannels,
    getStats,
  } = useChannelStore();

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const filteredChannels = getFilteredChannels();
  const stats = getStats();

  const availableTypes = useMemo(() => {
    const types = new Set(channels.map((c) => c.type));
    return Array.from(types).sort();
  }, [channels]);

  const deletingChannel = channels.find((c) => c.id === confirmDeleteId);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto p-6">
        {/* 页面标题 */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            渠道管理
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            管理消息渠道集成（QQ/微信/Discord 等）
          </p>
        </div>

        {/* 统计面板 */}
        <ChannelStatsPanel stats={stats} />

        {/* 搜索筛选栏 */}
        <ChannelFilterBar
          filters={filters}
          availableTypes={availableTypes}
          onFiltersChange={setFilters}
          isRefreshing={isRefreshing}
          onRefresh={refreshChannels}
        />

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={clearError}
              className="ml-2 text-red-500 hover:text-red-700 dark:hover:text-red-300 underline"
            >
              关闭
            </button>
          </div>
        )}

        {/* 渠道列表 */}
        {isLoading ? (
          <div className="space-y-3">
            <SkeletonCard count={3} />
          </div>
        ) : filteredChannels.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            {channels.length === 0 ? "暂无渠道配置" : "没有匹配的渠道"}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredChannels.map((channel) => (
              <div
                key={channel.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* 类型标签 */}
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full font-medium whitespace-nowrap ${CHANNEL_TYPE_COLORS[channel.type] || "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400"}`}
                  >
                    {CHANNEL_TYPE_LABELS[channel.type] || channel.type}
                  </span>

                  {/* 名称 + 状态 */}
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {channel.name}
                    </h3>
                    <div className="flex items-center gap-3">
                      {/* 连接状态 */}
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            channel.status === "error"
                              ? "bg-red-500"
                              : channel.connected
                                ? "bg-green-500"
                                : "bg-gray-400"
                          }`}
                        />
                        <span
                          className={
                            channel.connected
                              ? "text-green-600 dark:text-green-400"
                              : "text-gray-400"
                          }
                        >
                          {channel.connected ? "已连接" : "未连接"}
                        </span>
                      </span>

                      {channel.messageCount !== undefined && (
                        <span className="text-xs text-gray-400">
                          消息: {channel.messageCount}
                        </span>
                      )}

                      {channel.errorCount !== undefined &&
                        channel.errorCount > 0 && (
                          <span className="text-xs text-red-400">
                            错误: {channel.errorCount}
                          </span>
                        )}

                      {channel.lastActive && (
                        <span className="text-xs text-gray-400">
                          最后活动:{" "}
                          {new Date(channel.lastActive).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 操作区 */}
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {/* 配置按钮 — 所有渠道均可查看 */}
                  <button
                    onClick={() => openEditModal(channel)}
                    className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded transition-colors"
                  >
                    配置
                  </button>

                  {/* 启用开关（未注册渠道显示标签） */}
                  {channel.registered ? (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={channel.enabled}
                        onChange={() =>
                          toggleChannel(channel.id, !channel.enabled)
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                    </label>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                      未注册
                    </span>
                  )}

                  {/* 删除按钮（仅已注册渠道可删除） */}
                  {channel.registered && (
                    <button
                      onClick={() => promptDelete(channel.id)}
                      className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded transition-colors"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Phase 2: 编辑模态框 */}
        <ChannelFormModal visible={showFormModal} channel={editingChannel} />

        {/* Phase 2: 删除确认对话框 */}
        <ConfirmDialog
          open={confirmDeleteId !== null}
          title="确认删除"
          message={
            deletingChannel
              ? `确定要删除渠道「${deletingChannel.name}」吗？此操作不可撤销。`
              : ""
          }
          confirmText="删除"
          variant="danger"
          onConfirm={() => {
            if (confirmDeleteId) deleteChannel(confirmDeleteId);
          }}
          onCancel={cancelDelete}
        />
      </div>
    </div>
  );
}

export default ChannelsPage;
