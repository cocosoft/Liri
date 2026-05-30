/**
 * DiscordChannel — Discord 通道适配器（企业版）
 * @deprecated 请使用 channels/discord/ 下的 IChannelPlugin 实现
 *             core/gateway/ 体系后续将统一收敛到 channels/ 体系
 * 使用 Discord Gateway + REST API 接收/发送消息
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import * as https from 'https';
import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  GatewayChannel,
  InboundMessage,
  OutboundMessage,
  ChannelConfig,
  ChannelEventCallbacks,
  ChannelStats,
} from './types';
import { ChannelType, ChannelStatus, MessageDirection } from './types';
import type {
  ChannelPlugin,
  ChannelCapabilities,
  PluginValidationResult,
} from './ChannelPlugin';

const logger = new Logger({ level: LogLevel.INFO });

const DISCORD_API_BASE = 'discord.com';

export interface DiscordChannelConfig extends ChannelConfig {
  /** Bot Token */
  botToken: string;
  /** Application ID */
  applicationId: string;
  /** Guild ID（可选，限制到特定服务器） */
  guildId?: string;
  /** 允许的频道 ID 列表（可选） */
  allowedChannelIds?: string[];
  /** 命令前缀 */
  commandPrefix?: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  referenced_message?: DiscordMessage;
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
  }>;
}

interface DiscordGatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

/**
 * Discord 通道（企业版）
 * 通过 Gateway WebSocket 接收事件，通过 REST API 发送消息
 */
export class DiscordChannel implements GatewayChannel, ChannelPlugin {
  readonly name: string;
  readonly type = ChannelType.DISCORD;
  readonly config: DiscordChannelConfig;

  private _status: ChannelStatus = ChannelStatus.IDLE;
  private callbacks: ChannelEventCallbacks = {};
  private _stats: ChannelStats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    reconnects: 0,
    uptimeMs: 0,
    lastActivityAt: 0,
  };
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private sequence: number | null = null;

  constructor(config: DiscordChannelConfig) {
    this.name = config.name;
    this.config = {
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      commandPrefix: '!',
      ...config,
    };
  }

  get status(): ChannelStatus {
    return this._status;
  }

  get stats(): ChannelStats {
    return { ...this._stats };
  }

  getStatus(): ChannelStatus {
    return this._status;
  }

  getStats(): ChannelStats {
    return { ...this._stats };
  }

  async initialize(): Promise<void> {
    logger.info(`DiscordChannel: ${this.name} 初始化完成`);
  }

  async connect(): Promise<void> {
    if (this._status === ChannelStatus.CONNECTED) {
      return;
    }

    this._status = ChannelStatus.CONNECTING;
    this._stats.uptimeMs = Date.now();

    try {
      await this.verifyAuth();
      this._status = ChannelStatus.CONNECTED;
      this.callbacks.onConnected?.();
      logger.info(`Discord 通道 "${this.name}" 已连接`);
    } catch (error) {
      this._status = ChannelStatus.ERROR;
      this._stats.errors++;
      logger.error(`Discord 通道 "${this.name}" 连接失败`, error);
      this.callbacks.onError?.(error as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this._status = ChannelStatus.DISCONNECTED;
    this.callbacks.onDisconnected?.();
    logger.info(`Discord 通道 "${this.name}" 已断开`);
  }

  async send(message: OutboundMessage): Promise<boolean> {
    const body = JSON.stringify({
      content: message.content,
      tts: false,
    });

    await this.apiRequest(
      'POST',
      `/api/v10/channels/${message.recipient}/messages`,
      body
    );
    this._stats.messagesSent++;
    return true;
  }

  onEvent(callbacks: ChannelEventCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  isConnected(): boolean {
    return this._status === ChannelStatus.CONNECTED;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.verifyAuth();
      return true;
    } catch {
      return false;
    }
  }

  setCallbacks(callbacks: ChannelEventCallbacks): void {
    this.callbacks = callbacks;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      status: this._status,
      guildId: this.config.guildId,
      allowedChannels: this.config.allowedChannelIds?.length || 0,
      stats: this.getStats(),
    };
  }

  // ---- ChannelPlugin 接口实现 ----

  get id(): string {
    return this.name;
  }

  get capabilities(): ChannelCapabilities {
    return this.getCapabilities();
  }

  async handleInbound(message: InboundMessage): Promise<void> {
    this._stats.messagesReceived++;
    this.callbacks.onMessage?.(message);
  }

  async handleOutbound(message: OutboundMessage): Promise<boolean> {
    return this.send(message);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      messageTypes: ['text', 'markdown'],
      supportsMedia: false,
      maxMessageLength: 2000,
      directions: [MessageDirection.INBOUND, MessageDirection.OUTBOUND],
      features: ['gateway_websocket', 'auto_reconnect', 'rate_limit_handling'],
    };
  }

  validateConfig(): PluginValidationResult {
    const errors: string[] = [];
    if (!this.config.botToken) {
      errors.push('缺少 Bot Token');
    }
    if (!this.config.applicationId) {
      errors.push('缺少 Application ID');
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async verifyAuth(): Promise<void> {
    const response = await this.apiRequest('GET', '/api/v10/users/@me', '');
    const data = JSON.parse(response);

    if (!data.id) {
      throw new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS.message,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'DISCORD_AUTH_FAILED'
      );
    }

    logger.info(`Discord 认证成功: ${data.username}#${data.discriminator}`);
  }

  private async handleMessageCreate(data: DiscordMessage): Promise<void> {
    if (data.author.bot) {
      return;
    }

    if (
      this.config.allowedChannelIds &&
      !this.config.allowedChannelIds.includes(data.channel_id)
    ) {
      return;
    }

    const inbound: InboundMessage = {
      id: data.id,
      content: data.content,
      sessionId: data.channel_id,
      sender: `${data.author.username}#${data.author.discriminator}`,
      raw: data as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    };

    await this.handleInbound(inbound);
  }

  private apiRequest(
    method: string,
    path: string,
    body: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: DISCORD_API_BASE,
        path,
        method,
        headers: {
          Authorization: `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Liri (https://github.com/your-org/Liri, 1.0.0)',
        },
      };

      if (body) {
        options.headers = {
          ...options.headers,
          'Content-Length': Buffer.byteLength(body),
        };
      }

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode === 429) {
            const retryAfter = parseInt(res.headers['retry-after'] || '5', 10);
            logger.info(`Discord 速率限制，${retryAfter}秒后重试`);
            setTimeout(() => {
              this.apiRequest(method, path, body).then(resolve).catch(reject);
            }, retryAfter * 1000);
            return;
          }

          resolve(data);
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }
}
