/** Inbox 项类型 */
export type InboxItemType = "approval" | "question" | "authorization";

/** Inbox 项状态 */
export type InboxItemStatus = "pending" | "replied" | "expired" | "dismissed";

/** Inbox 项（与后端 InboxItem 对齐） */
export interface InboxItem {
  id: string;
  sessionId: string;
  type: InboxItemType;
  title: string;
  message: string;
  status: InboxItemStatus;
  reply?: string;
  options?: string[];
  offlineCapable: boolean;
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  repliedAt?: number;
  /** 来源渠道 ID（如 'qq', 'telegram'） */
  channelId?: string;
  /** 全链路追踪 ID */
  traceId?: string;
}

/** 渠道名称映射 */
export const CHANNEL_LABELS: Record<string, string> = {
  qq: "QQ",
  wechat: "微信",
  telegram: "Telegram",
  discord: "Discord",
  feishu: "飞书",
  dingtalk: "钉钉",
  wecom: "企业微信",
  slack: "Slack",
  line: "Line",
  whatsapp: "WhatsApp",
  email: "邮件",
  sms: "短信",
  webhook: "Webhook",
  googlechat: "Google Chat",
  msteams: "MS Teams",
  signal: "Signal",
  matrix: "Matrix",
  facebook: "Facebook",
  twitter: "Twitter/X",
  claude: "Claude",
  mattermost: "Mattermost",
  bluebubbles: "iMessage",
  irc: "IRC",
  nostr: "Nostr",
  zalo: "Zalo",
  yuanbao: "元宝",
};

/** 获取渠道显示名称 */
export function getChannelLabel(channelId?: string): string {
  if (!channelId) return "";
  return CHANNEL_LABELS[channelId] || channelId;
}
