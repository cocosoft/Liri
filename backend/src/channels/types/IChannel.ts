/**
 * 通道接口契约
 * 定义通道插件必须实现的核心接口，5 个 Adapter
 * 对齐 OpenClaw channels/plugins/types.plugin.ts
 */

export type ChannelId =
  | 'wecom'
  | 'feishu'
  | 'dingtalk'
  | 'wechat'
  | 'wechat-bot'
  | 'qq'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'line'
  | 'irc'
  | 'nostr'
  | 'email'
  | 'sms'
  | 'webhook'
  | 'googlechat'
  | 'msteams'
  | 'zalo'
  | 'yuanbao'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'facebook'
  | 'twitter'
  | 'claude';

export type DmPolicy = 'pairing' | 'allowlist' | 'open';

export interface ChannelMeta {
  id: ChannelId;
  displayName: string;
  vendor: string;
  vendorSite: string;
  icon: string;
  markdownCapable: boolean;
  maxMessageLength: number;
  supportedMessageTypes: ('text' | 'image' | 'file' | 'markdown' | 'card')[];
}

export interface ChannelCapabilities {
  directMessage: boolean;
  groupMessage: boolean;
  groupMention: boolean;
  threading: boolean;
  reactions: boolean;
  interactive: boolean;
  voiceCall: boolean;
  fileUpload: boolean;
  imageMessage: boolean;
  webhook: boolean;
}

export interface MessageContext {
  channelId: ChannelId;
  senderId: string;
  senderName?: string;
  groupId?: string;
  conversationId?: string;
  messageId: string;
  messageType: 'text' | 'image' | 'file' | 'voice' | 'event' | 'unknown';
  content: string;
  timestamp: number;
  isDirectMessage: boolean;
  rawPayload: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  latencyMs?: number;
}

export interface InteractiveCard {
  title: string;
  content: string;
  buttons?: Array<{
    text: string;
    value: string;
    style?: 'primary' | 'default' | 'danger';
  }>;
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'grey';
}

export interface ChannelStatus {
  connected: boolean;
  latencyMs: number;
  lastMessageAt: number | null;
  uptimeMs: number;
  error?: string;
}

export interface ResolvedSender {
  userId: string;
  displayName: string;
  isApproved: boolean;
  approvalTime?: number;
  metadata?: Record<string, unknown>;
}

export interface IChannelConfigAdapter {
  validate(config: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
  };
  getDefaultConfig(): Record<string, unknown>;
}

export interface IChannelLifecycleAdapter {
  connect(config: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
  getStatus(): ChannelStatus;
}

export interface IChannelOutboundAdapter {
  sendText(target: string, content: string): Promise<SendResult>;
  sendMarkdown(target: string, content: string): Promise<SendResult>;
  sendImage(target: string, imageUrl: string): Promise<SendResult>;
  sendFile(target: string, filePath: string): Promise<SendResult>;
  sendInteractive(target: string, card: InteractiveCard): Promise<SendResult>;
}

export interface IChannelSecurityAdapter {
  dmPolicy: DmPolicy;
  allowFrom?: string[];
  pairingCodeTimeoutMs: number;
  maxPairingAttempts: number;
  resolveSender(sender: Record<string, unknown>): Promise<ResolvedSender>;
  authorizeMessage(
    ctx: MessageContext
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export interface IChannelPairingAdapter {
  generatePairingCode(userId: string): Promise<string>;
  validatePairingCode(userId: string, code: string): Promise<boolean>;
  listApprovedUsers(): Promise<string[]>;
  removeApprovedUser(userId: string): Promise<void>;
}

/** 入站消息接收协议类型 */
export type InboundProtocol = 'websocket' | 'webhook' | 'polling' | 'none';

/**
 * IChannelInboundAdapter — 入站消息接收适配器
 *
 * 定义通道接收外部消息的统一接口，各通道根据自身协议实现：
 * - QQ/Discord → WebSocket 长连接（gateway + wss）
 * - Telegram → Webhook HTTP 服务或 long-polling
 * - 微信/钉钉/飞书 → HTTP Server 接收回调
 * - Email → IMAP/ POP3 轮询
 */
export interface IChannelInboundAdapter {
  /** 接收协议类型 */
  readonly protocol: InboundProtocol;

  /** 是否正在监听消息 */
  readonly isListening: boolean;

  /**
   * 启动消息接收
   * @param config 通道配置（含连接参数）
   */
  start(config: Record<string, unknown>): Promise<void>;

  /**
   * 停止消息接收
   */
  stop(): Promise<void>;

  /**
   * 设置消息回调
   * 当通道收到外部消息时，通过此回调将消息传递给上层路由
   * @param handler 消息处理函数，接收 MessageContext 并返回处理结果
   */
  setMessageHandler(handler: (message: MessageContext) => Promise<void>): void;
}

export interface IChannelPlugin {
  readonly id: ChannelId;
  readonly meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: IChannelConfigAdapter;
  lifecycle: IChannelLifecycleAdapter;
  outbound: IChannelOutboundAdapter;
  security: IChannelSecurityAdapter;
  pairing?: IChannelPairingAdapter;

  /** 入站消息接收适配器（可选，各通道按需实现） */
  inbound?: IChannelInboundAdapter;
}
