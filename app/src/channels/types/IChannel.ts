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
  | 'claude'
  | 'mattermost'
  | 'bluebubbles';

export type DmPolicy = 'pairing' | 'allowlist' | 'open';

export interface ChannelMessageToolHints {
  /** 回复风格偏好 */
  responsePreference?: 'concise' | 'detailed' | 'markdown' | 'card';
  /** 平台特有的格式化提示 */
  formattingTips?: string[];
  /** 推荐的消息最大长度 */
  recommendedMaxLength?: number;
  /** 平台支持的特殊能力列表 */
  platformCapabilities?: string[];
  /** 平台特有约束说明 */
  constraints?: string[];
}

export interface ChannelMeta {
  id: ChannelId;
  displayName: string;
  vendor: string;
  vendorSite: string;
  icon: string;
  markdownCapable: boolean;
  maxMessageLength: number;
  supportedMessageTypes: ('text' | 'image' | 'file' | 'markdown' | 'card')[];
  /** 通道平台特有提示，指导 LLM 生成适配的消息 */
  messageToolHints?: ChannelMessageToolHints;
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
  /**
   * 平台存在被动回复窗口（如 QQ 官方 5 分钟：收到消息后限时内可回，
   * 超时拒收需走主动消息配额）。声明该位的渠道才会收到长任务占位提示
   * （messageRouter AC-5③）；无窗口约束的渠道（email/sms/webhook 等
   * 主动 API 出站）不适用，缺省视为 false。
   */
  passiveReplyWindow?: boolean;
}

/**
 * 入站**通道附件**（**通道协议层**载体）。
 *
 * ⚠️ **归属裁定（2026-10-12 · 通道治理 阶段 1.3 收口）**：本类型描述"**平台给了什么**"
 * （`fileId` / `mimeType` / 原始 `data`），属**通道协议层**。它与
 * `session/types/message/enums.ts` 中的**同名** `MessageAttachment`（**会话领域模型**：含
 * `id` / `contentType` / `metadata`，供存储与前端）**同名不同物** ⇒ **保持独立、严禁合并**，
 * 也**严禁**用类型断言互相赋值 —— 对齐本仓既有判例（`enums.ts` 对 `DataAttachment` 的规定：
 * 协议/存储向模型与领域模型形状不等价，**勿直接互换**）。
 *
 * 跨层时**必须写显式适配函数**（字段改名：`fileId→id`、`fileName→name`、`mimeType→contentType`，
 * 并补齐缺失的 `type`）。
 */
export interface MessageAttachment {
  /** 平台文件 ID（如 Telegram file_id） */
  fileId?: string;
  /** 原始文件名 */
  fileName: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 已下载的文件内容 */
  data?: Buffer;
  /** 文件远程 URL（未下载时） */
  url?: string;
  /** 文件大小（字节） */
  size?: number;
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

  /** 消息附件列表（渠道下载后通过 FileRegistry 注册前提供） */
  attachments?: MessageAttachment[];
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
