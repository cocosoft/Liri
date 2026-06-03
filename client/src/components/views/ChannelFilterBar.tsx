/**
 * ChannelFilterBar — 渠道搜索筛选栏
 * 对标 OpenClaw HermesChannelsPage 筛选栏
 * 支持关键词搜索、状态筛选、类型筛选、刷新
 */

type StatusFilter =
  | "all"
  | "connected"
  | "disconnected"
  | "enabled"
  | "disabled";

interface ChannelFilters {
  search: string;
  status: StatusFilter;
  type: string;
}

interface ChannelFilterBarProps {
  filters: ChannelFilters;
  availableTypes: string[];
  onFiltersChange: (partial: Partial<ChannelFilters>) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}

/** 渠道类型中文标签 */
const TYPE_LABELS: Record<string, string> = {
  qq: "QQ",
  wechat: "微信",
  wecom: "企业微信",
  feishu: "飞书",
  dingtalk: "钉钉",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  line: "Line",
  email: "邮件",
  webhook: "Webhook",
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

function ChannelFilterBar({
  filters,
  availableTypes,
  onFiltersChange,
  isRefreshing,
  onRefresh,
}: ChannelFilterBarProps) {
  return (
    <div className="mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_160px_40px] gap-3 items-center">
        {/* 搜索输入 */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
            placeholder="搜索渠道名称或类型..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {filters.search && (
            <button
              onClick={() => onFiltersChange({ search: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          )}
        </div>

        {/* 状态筛选 */}
        <select
          value={filters.status}
          onChange={(e) =>
            onFiltersChange({ status: e.target.value as StatusFilter })
          }
          className="py-2 px-3 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">全部状态</option>
          <option value="connected">已连接</option>
          <option value="disconnected">未连接</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已禁用</option>
        </select>

        {/* 类型筛选 */}
        <select
          value={filters.type}
          onChange={(e) => onFiltersChange({ type: e.target.value })}
          className="py-2 px-3 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全部类型</option>
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] || t}
            </option>
          ))}
        </select>

        {/* 刷新按钮 */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
          title="刷新"
        >
          <span className={`text-lg ${isRefreshing ? "animate-spin" : ""}`}>
            🔄
          </span>
        </button>
      </div>
    </div>
  );
}

export default ChannelFilterBar;
