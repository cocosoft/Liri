export type ChannelType =
  | "wecom"
  | "feishu"
  | "dingtalk"
  | "wechat"
  | "qq"
  | "telegram"
  | "discord"
  | "slack"
  | "line"
  | "whatsapp"
  | "signal"
  | "matrix"
  | "irc"
  | "nostr"
  | "email"
  | "sms"
  | "webhook"
  | "googlechat"
  | "msteams"
  | "zalo"
  | "yuanbao"
  | "facebook"
  | "twitter"
  | "mattermost"
  | "bluebubbles";

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  connected: boolean;
  registered: boolean;
  status?: "online" | "offline" | "error";
  messageCount?: number;
  errorCount?: number;
  config?: Record<string, unknown>;
  lastActive?: number;
}

export interface ChannelFormData {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface UpdateChannelRequest {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface ChannelHealth {
  channelId: string;
  connected: boolean;
  healthy: boolean;
  latencyMs?: number;
  messageCount: number;
  errorCount: number;
  lastHeartbeatAt?: number;
}

export interface ChannelPluginInfo {
  name: string;
  version: string;
  installed: boolean;
  installedAt?: number;
}