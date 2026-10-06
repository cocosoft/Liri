/**
 * types.ts — QQ 通道协议常量、网关负载类型与通道元数据
 *
 * 由 `QQChannel.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §40）：**只搬不改**，逐字保留原注释。
 *
 * 依赖方向：本模块**零依赖宿主**；宿主与 `closeCodeAnalysis.ts` 单向 import 本模块
 * ⇒ 无循环。
 */

import type { ChannelMeta, ChannelCapabilities } from '@modules/channels/types';

export const QQ_META: ChannelMeta = {
  id: 'qq',
  displayName: 'QQ Bot',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://q.qq.com/',
  icon: '🐧',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
};

export const QQ_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  // 2026-08-20 spec qq-file-transfer：c2c/群支持富媒体文件上传（频道由 sendFileMessage 守卫拦截）
  fileUpload: true,
  imageMessage: true,
  webhook: true,
  // AC-5③：QQ 官方被动回复窗口（5 分钟），声明后 router 才发送长任务占位提示
  passiveReplyWindow: true,
};

/** QQ Bot WebSocket OP Code */
export const enum QQOpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/** QQ Bot WebSocket 关闭码 */
export const enum QQCloseCode {
  NORMAL = 1000,
  AUTH_FAILED = 4004,
  INVALID_SESSION = 4006,
  SEQ_OUT_OF_RANGE = 4007,
  RATE_LIMITED = 4008,
  SESSION_TIMEOUT = 4009,
  SERVER_ERROR_START = 4900,
  SERVER_ERROR_END = 4913,
  INSUFFICIENT_INTENTS = 4914,
  DISALLOWED_INTENTS = 4915,
}

/** QQ Bot WebSocket 事件类型 */
export const QQEventType = {
  READY: 'READY',
  RESUMED: 'RESUMED',
  AT_MESSAGE_CREATE: 'AT_MESSAGE_CREATE',
  C2C_MESSAGE_CREATE: 'C2C_MESSAGE_CREATE',
  GROUP_AT_MESSAGE_CREATE: 'GROUP_AT_MESSAGE_CREATE',
  DIRECT_MESSAGE_CREATE: 'DIRECT_MESSAGE_CREATE',
} as const;

/**
 * QQ Bot 网关意图（OpenClaw FULL_INTENTS 标准）
 * 1 << 30: PUBLIC_GUILD_MESSAGES（频道消息）
 * 1 << 25: GROUP_AND_C2C（群聊和私信）
 * 1 << 12: DIRECT_MESSAGE（频道私信）
 */
export const QQ_INTENT_FULL = (1 << 30) | (1 << 25) | (1 << 12);

/** 重连指数退避延迟（毫秒） */
export const RECONNECT_DELAYS = [
  1000, 2000, 5000, 10000, 30000, 60000,
] as const;

/** 最大重连尝试次数 */
export const MAX_RECONNECT_ATTEMPTS = 50;

/** 限流等待延迟（毫秒） */
export const RATE_LIMIT_DELAY = 60000;

/** 快速断开检测阈值（毫秒） */
export const QUICK_DISCONNECT_THRESHOLD = 5000;

/** Token 后台刷新提前量（毫秒）：过期前 5 分钟刷新 */
export const TOKEN_REFRESH_AHEAD_MS = 5 * 60 * 1000;

/** 连续会话失败上限（鉴权级错误阈值）：超过此值 → 熔断停连 + 告警推送
 *  2026-08-21 从 5 降为 3：日志实证 1.4s 一轮×68 次 ERROR，
 *  对于 intents 权限未审核这种静态配置错误，降频重试毫无意义
 *  （符合 CS02：intents 审核状态是持久化标记，非字符串匹配）。 */
export const MAX_CONSECUTIVE_SESSION_FAILURES = 3;

/** 连续丢失心跳 ACK 上限：达到即判定为死链（半开连接，NAT 超时/网络静默断开） */
export const MAX_MISSED_HEARTBEAT_ACKS = 2;

/** 停连降频自愈的长期退避延迟（毫秒）：会话连续失败/重连次数耗尽后 5 分钟再试，不永久放弃 */
export const LONG_BACKOFF_DELAY_MS = 300_000;

/** QQ Bot 网关消息负载 */
export interface QQGatewayPayload {
  op: QQOpCode;
  s?: number;
  t?: string;
  d: unknown;
}

/** QQ Bot Ready 事件数据 */
export interface QQReadyPayload {
  version: number;
  session_id: string;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
  shard: [number, number];
}

/** QQ Bot AT_MESSAGE_CREATE 事件数据（频道 @消息） */
export interface QQAtMessageCreatePayload {
  id: string;
  channel_id: string;
  guild_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  member?: {
    joined_at?: string;
    roles?: string[];
  };
}

/** QQ Bot 富媒体附件（C2C/群媒体事件携带，url 为 CDN 临时链接有时效） */
export interface QQAttachment {
  /** 富媒体子类型：0=文本 1=图片 2=视频 3=语音 4=文件 */
  content_type: number;
  filename?: string;
  height?: number;
  width?: number;
  size?: number;
  url?: string;
}

/** QQ Bot C2C_MESSAGE_CREATE 事件数据（私聊） */
export interface QQC2cMessageCreatePayload {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  timestamp?: string;
  /** 富媒体附件（用户发图片/文件时存在） */
  attachments?: QQAttachment[];
}

/** QQ Bot GROUP_AT_MESSAGE_CREATE 事件数据（群聊 @消息） */
export interface QQGroupAtMessageCreatePayload {
  id: string;
  group_openid: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  timestamp?: string;
}

/** QQ Bot DIRECT_MESSAGE_CREATE 事件数据（频道私信） */
export interface QQDirectMessageCreatePayload {
  id: string;
  guild_id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar?: string;
  };
  timestamp?: string;
}
