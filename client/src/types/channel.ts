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

/** 所有通道健康聚合（GET /v1/channels/health，P2-6 / 4.12） */
export interface ChannelHealthAggregate {
  channels: Array<{
    channelId: string;
    healthy: boolean;
    connected: boolean;
    latencyMs: number;
    status: string;
    error?: string;
  }>;
  stats: {
    total: number;
    healthy: number;
    unhealthy: number;
    overallStatus: string;
  };
}

/** 渠道可观测性指标条目（GET /v1/channels/metrics，key 形如 `name{label=k,v}`） */
export interface ChannelMetricEntry {
  key: string;
  value?: number;
  count?: number;
  sum?: number;
  buckets?: Record<string, number>;
  quantiles?: Record<string, number>;
}

/** 渠道可观测性指标响应体（GET /v1/channels/metrics） */
export interface ChannelMetricsResponse {
  metrics: ChannelMetricEntry[];
  updatedAt: number;
}

/** 渠道配置字段定义（GET /v1/channels/schema，4.1：后端单一来源） */
export interface PlatformFieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password" | "number";
  required?: boolean;
}

/** 渠道字段渲染 schema 响应体 */
export interface ChannelSchema {
  platforms: Record<string, PlatformFieldDef[]>;
  generic: PlatformFieldDef[];
}

export interface ChannelPluginInfo {
  name: string;
  version: string;
  installed: boolean;
  installedAt?: number;
}
