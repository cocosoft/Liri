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

/** 渠道运行时五态（GET /v1/channels/monitor/*，ChannelRealtimeMonitor） */
export type ChannelRuntimeStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/** 单渠道实时状态快照（GET /v1/channels/monitor/status） */
export interface ChannelRuntimeStatusInfo {
  channelId: string;
  type: string;
  enabled: boolean;
  status: ChannelRuntimeStatus;
  /** null = 尚未探测过 */
  healthy: boolean | null;
  latencyMs: number | null;
  lastMessageAt: number | null;
  uptimeMs: number;
  reconnectCount: number;
  lastProbeAt: number | null;
  lastError: string | null;
  /** 最近错误尾部快照（最多 2000 字符），诊断断连原因 */
  lastErrorSnapshot: string | null;
}

/** 渠道实时监控响应体（GET /v1/channels/monitor/status） */
export interface ChannelMonitorStatusResponse {
  channels: ChannelRuntimeStatusInfo[];
  updatedAt: number;
}

/** 渠道实时监控 SSE 事件（GET /v1/channels/monitor/stream） */
export interface ChannelMonitorEvent {
  type: "status_change" | "reconnecting" | "recovered" | "probe_failed";
  channelId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** 强制重连响应体（POST /v1/channels/monitor/force-reconnect） */
export interface ChannelForceReconnectResponse {
  channelId: string;
  recovered: boolean;
  error?: string;
}

/** 消息链路阶段状态（方案 A：消息级全链路追踪） */
export type MessageTraceStageStatus = "ok" | "fail" | "skip";

/** 单个链路阶段记录 */
export interface MessageTraceStage {
  /** 阶段名（frame_check / dedup / rate_limit / session / llm / outbound） */
  name: string;
  status: MessageTraceStageStatus;
  atMs: number;
  durationMs?: number;
  detail?: string;
}

/** 消息整体状态 */
export type MessageTraceStatus = "inflight" | "ok" | "fail" | "rejected";

/** 单条消息的全链路追踪记录 */
export interface MessageTrace {
  traceId: string;
  channelName: string;
  messageId: string;
  sessionId?: string;
  senderId?: string;
  contentPreview: string;
  startedAtMs: number;
  finishedAtMs?: number;
  totalMs?: number;
  status: MessageTraceStatus;
  error?: string;
  stages: MessageTraceStage[];
}

/** 最近消息链路响应体（GET /v1/channels/messages/trace） */
export interface MessageTracesResponse {
  traces: MessageTrace[];
  total: number;
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
