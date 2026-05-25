/**
 * QQ Bot 通道插件
 * 厂商: 腾讯, 协议: QQ 开放平台 WebSocket 长连接
 * 特色: 支持出站 HTTP API 消息发送 + 入站 WebSocket 消息接收
 *
 * 入站流程:
 *   1. GET gateway URL → 2. WebSocket connect → 3. Identify → 4. Heartbeat → 5. 监听 AT_MESSAGE_CREATE
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  MessageContext,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const QQ_META: ChannelMeta = {
  id: 'qq',
  displayName: 'QQ Bot',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://q.qq.com/',
  icon: '🐧',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
};

const QQ_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: true,
  webhook: true,
};

/** QQ Bot WebSocket OP Code */
const enum QQOpCode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  RESUME = 6,
  RECONNECT = 7,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

/** QQ Bot WebSocket 事件类型 */
const QQEventType = {
  READY: 'READY',
  AT_MESSAGE_CREATE: 'AT_MESSAGE_CREATE',
} as const;

/** QQ Bot 网关意图：GUILD_MESSAGES = 1 << 30，覆盖 AT_MESSAGE_CREATE */
const QQ_INTENT_GUILD_MESSAGES = 1 << 30;

class QQChannelPlugin extends BaseChannelPlugin {
  readonly id = 'qq';
  readonly meta = QQ_META;
  readonly capabilities = QQ_CAPABILITIES;

  private appId = '';
  private secret = '';

  /** 缓存的 Access Token */
  private accessToken = '';
  /** Access Token 过期时间戳（毫秒） */
  private accessTokenExpiresAt = 0;

  // 出站连接状态
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;

  // 入站 WebSocket 连接
  private ws: WebSocket | null = null;
  private gatewayUrl = '';
  private heartbeatSeq = 0;
  private lastSeq: number | null = null;
  private heartbeatIntervalMs = 30000;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectBaseDelay = 2000;
  private shouldReconnect = true;

  /** QQ 提及正则（@bot） */
  private readonly mentionPattern = /<@!\d+>/g;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'pairing' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const author = sender['author'] as Record<string, unknown> | undefined;
        const userId =
          (sender['id'] as string) || (author?.['id'] as string) || 'unknown';
        const username = (author?.['username'] as string) || userId;
        return { userId, displayName: username, isApproved: false };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`QQ Bot 配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) =>
        code.length === 6,
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      appId: '',
      secret: '',
      webhookPort: 8086,
      wsHost: 'api.sgroup.qq.com',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId (QQ Bot AppID)');
    if (!config['secret']) errors.push('缺少 secret (QQ Bot AppSecret)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appId = (config['appId'] as string) || '';
    this.secret = (config['secret'] as string) || '';

    if (!this.appId || !this.secret)
      throw new AppError(
        'QQ Bot: appId 和 secret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'qq', missing: ['appId', 'secret'] }
      );

    // 获取 Access Token
    await this.refreshAccessToken();

    this.gatewayUrl = (config['wsHost'] as string) || 'api.sgroup.qq.com';

    this.logger.info('QQ Bot 通道已连接');
  }

  /**
   * 从 QQ 开放平台换取 Access Token（OAuth 2.0 Client Credentials）
   * POST https://bots.qq.com/app/getAppAccessToken
   */
  private async refreshAccessToken(): Promise<void> {
    const resp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.secret }),
    });

    if (!resp.ok) {
      throw new AppError(
        `获取 QQ Bot Access Token 失败: ${resp.status}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'ACCESS_TOKEN_FETCH_FAILED',
        { channel: 'qq', status: resp.status }
      );
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in: string;
    };

    this.accessToken = data.access_token;
    // expires_in 单位秒，提前 60 秒刷新
    this.accessTokenExpiresAt =
      Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;

    this.logger.info('QQ Bot Access Token 已获取', {
      expiresAt: new Date(this.accessTokenExpiresAt).toISOString(),
    });
  }

  /**
   * 获取有效的 Access Token（含缓存和自动刷新）
   */
  private async getAccessToken(): Promise<string> {
    // 缓存有效且未过期，直接返回
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    // 过期或未获取，重新换取
    await this.refreshAccessToken();
    return this.accessToken;
  }

  protected override async onDisconnect(): Promise<void> {
    this.shouldReconnect = false;
    await this.stopInboundConnection();
    this.clearTimers();
    this.accessToken = '';
    this.accessTokenExpiresAt = 0;
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const token = await this.getAccessToken();
      const resp = await fetch('https://api.sgroup.qq.com/gateway', {
        headers: { Authorization: `QQBot ${token}` },
      });
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: this.state.connected, latencyMs: Date.now() - start };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.appId) return { success: false, error: '未连接' };
    try {
      const token = await this.getAccessToken();
      const body = {
        msg_type: 0,
        content: content.slice(0, QQ_META.maxMessageLength),
        msg_id: `${Date.now()}`,
      };
      const url = target.includes('channels/')
        ? `https://api.sgroup.qq.com/channels/${target}/messages`
        : `https://api.sgroup.qq.com/v2/users/${target}/messages`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `QQBot ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = resp.ok;
      return {
        success: ok,
        error: ok ? undefined : (data['message'] as string),
        messageId: data['id'] as string,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.appId) return { success: false, error: '未连接' };
    try {
      const token = await this.getAccessToken();
      const body = {
        msg_type: 2,
        markdown: { content },
        msg_id: `${Date.now()}`,
      };
      const resp = await fetch(
        `https://api.sgroup.qq.com/v2/users/${target}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `QQBot ${token}`,
          },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: resp.ok,
        error: data['message'] as string,
        messageId: data['id'] as string,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return {
      success: false,
      error: 'QQ Bot 图片发送需先上传素材，暂未实现',
    };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'QQ Bot 文件发送暂未实现' };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const mdContent = `**${card.title}**\n${card.content}`;
    return this.sendMarkdownMessage(target, mdContent);
  }

  // ────────────────────────────────────────────────────────────
  // 入站 WebSocket 消息接收
  // ────────────────────────────────────────────────────────────

  /**
   * 覆写入站适配器创建方法，返回 WebSocket 实现
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        await self.startWebSocketListening();
      },

      stop: async (): Promise<void> => {
        self.shouldReconnect = false;
        await self.stopInboundConnection();
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  /**
   * 启动 WebSocket 长连接监听
   */
  private async startWebSocketListening(): Promise<void> {
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    try {
      await this.resolveGatewayUrl();
      await this.connectWebSocket();
    } catch (error) {
      this.logger.error('QQ Bot WebSocket 启动失败', {
        error: String(error),
      });
      this.setInboundListening(false);
    }
  }

  /**
   * 获取 QQ Bot WebSocket 网关地址
   */
  private async resolveGatewayUrl(): Promise<void> {
    const token = await this.getAccessToken();
    const resp = await fetch('https://api.sgroup.qq.com/gateway', {
      headers: { Authorization: `QQBot ${token}` },
    });

    if (!resp.ok) {
      throw new AppError(
        `获取 QQ Bot 网关地址失败: ${resp.status}`,
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        'GATEWAY_FETCH_FAILED',
        { channel: 'qq', status: resp.status }
      );
    }

    const data = (await resp.json()) as { url: string };
    this.gatewayUrl = data.url;
    this.logger.info('QQ Bot 网关地址已获取', { url: this.gatewayUrl });
  }

  /**
   * 建立 WebSocket 连接
   */
  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.gatewayUrl.startsWith('ws')
          ? this.gatewayUrl
          : `wss://${this.gatewayUrl}`;

        this.ws = new WebSocket(wsUrl);

        const connectTimeout = setTimeout(() => {
          reject(new Error('QQ Bot WebSocket 连接超时'));
        }, 15000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          this.logger.info('QQ Bot WebSocket 已连接');
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(
              event.data as string
            ) as QQGatewayPayload;
            this.handleGatewayPayload(payload).catch((error) => {
              this.logger.error('QQ Bot 网关消息处理异常', {
                error: String(error),
              });
            });
          } catch (error) {
            this.logger.error('QQ Bot WebSocket 消息解析失败', {
              error: String(error),
            });
          }
        };

        this.ws.onerror = (event: Event) => {
          clearTimeout(connectTimeout);
          this.logger.error('QQ Bot WebSocket 错误', { event });
          reject(new Error('QQ Bot WebSocket 连接错误'));
        };

        this.ws.onclose = (event: CloseEvent) => {
          clearTimeout(connectTimeout);
          this.logger.warn('QQ Bot WebSocket 连接关闭', {
            code: event.code,
            reason: event.reason,
          });
          this.handleDisconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理网关消息
   */
  private async handleGatewayPayload(payload: QQGatewayPayload): Promise<void> {
    switch (payload.op) {
      case QQOpCode.HELLO:
        await this.handleHello(payload.d as { heartbeat_interval: number });
        break;

      case QQOpCode.DISPATCH:
        this.handleDispatch(payload);
        break;

      case QQOpCode.HEARTBEAT_ACK:
        // 心跳确认，无需额外处理
        break;

      case QQOpCode.RECONNECT:
        this.logger.warn('QQ Bot 服务端要求重连');
        this.scheduleReconnect(0);
        break;

      case QQOpCode.INVALID_SESSION:
        this.logger.warn('QQ Bot 会话无效，重新鉴权');
        await this.identify();
        break;

      default:
        this.logger.debug('QQ Bot 未处理的 OP Code', { op: payload.op });
    }
  }

  /**
   * 处理 Hello 事件：启动心跳
   */
  private async handleHello(hello: {
    heartbeat_interval: number;
  }): Promise<void> {
    this.heartbeatIntervalMs = hello.heartbeat_interval;
    this.sessionId = null;
    this.lastSeq = null;

    this.logger.info('QQ Bot 收到 Hello，启动心跳', {
      interval: this.heartbeatIntervalMs,
    });

    this.startHeartbeat();

    await this.identify();
  }

  /**
   * 发送鉴权请求
   */
  private async identify(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const token = await this.getAccessToken();

    const identifyPayload = {
      op: QQOpCode.IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents: QQ_INTENT_GUILD_MESSAGES,
        shard: [0, 1],
        properties: {},
      },
    };

    this.ws.send(JSON.stringify(identifyPayload));
    this.logger.info('QQ Bot 鉴权请求已发送');
  }

  /**
   * 处理分发事件
   */
  private handleDispatch(payload: QQGatewayPayload): void {
    if (payload.s !== undefined) {
      this.lastSeq = payload.s;
    }

    switch (payload.t) {
      case QQEventType.READY:
        this.handleReady(payload.d as { session_id: string; user: unknown });
        break;

      case QQEventType.AT_MESSAGE_CREATE:
        this.handleAtMessageCreate(payload.d as QQAtMessageCreatePayload);
        break;

      default:
        break;
    }
  }

  /**
   * 处理 Ready 事件
   */
  private handleReady(readyData: { session_id: string; user: unknown }): void {
    this.sessionId = readyData.session_id;
    this.setInboundListening(true);
    this.reconnectAttempts = 0;
    this.logger.info('QQ Bot 鉴权成功，开始监听消息');
  }

  /**
   * 处理 AT_MESSAGE_CREATE 事件（用户 @机器人 的消息）
   */
  private handleAtMessageCreate(data: QQAtMessageCreatePayload): void {
    const cleanContent = data.content.replace(this.mentionPattern, '').trim();

    const message: MessageContext = {
      channelId: 'qq',
      senderId: data.author.id,
      senderName: data.author.username,
      groupId: data.guild_id,
      conversationId: data.channel_id,
      messageId: data.id,
      messageType: 'text',
      content: cleanContent || data.content,
      timestamp: Date.now(),
      isDirectMessage: false,
      rawPayload: data as unknown as Record<string, unknown>,
    };

    this.handleIncomingMessage(message).catch((error) => {
      this.logger.error('QQ Bot 消息处理异常', { error: String(error) });
    });
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  /**
   * 发送心跳
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const heartbeatPayload = {
      op: QQOpCode.HEARTBEAT,
      d: this.lastSeq,
    };

    this.ws.send(JSON.stringify(heartbeatPayload));
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.setInboundListening(false);

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('QQ Bot 重连已达最大次数，停止重连');
      return;
    }

    const delay =
      delayMs ??
      Math.min(
        this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
        30000
      );

    this.reconnectAttempts++;
    this.logger.info('QQ Bot 计划重连', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.resolveGatewayUrl();
        await this.connectWebSocket();
      } catch (error) {
        this.logger.error('QQ Bot 重连失败', {
          error: String(error),
          attempt: this.reconnectAttempts,
        });
      }
    }, delay);
  }

  /**
   * 停止入站连接
   */
  private async stopInboundConnection(): Promise<void> {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        this.ws.close(1000, '主动断开');
      } catch {
        // 关闭错误忽略
      }
      this.ws = null;
    }

    this.setInboundListening(false);
  }

  /**
   * 清理定时器
   */
  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** QQ Bot 网关消息负载 */
interface QQGatewayPayload {
  op: QQOpCode;
  s?: number;
  t?: string;
  d: unknown;
}

/** QQ Bot AT_MESSAGE_CREATE 事件数据 */
interface QQAtMessageCreatePayload {
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

function createQQChannel(): IChannelPlugin {
  return new QQChannelPlugin();
}

export const qqChannel = createQQChannel();
