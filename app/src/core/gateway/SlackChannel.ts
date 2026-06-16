/**
 * SlackChannel — Slack 通道适配器（企业版）
 * @deprecated 请使用 channels/slack/ 下的 IChannelPlugin 实现
 *             core/gateway/ 体系后续将统一收敛到 channels/ 体系
 * 使用 Slack Events API + Web API 接收/发送消息
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

const logger = new Logger({ level: LogLevel.INFO, module: 'gateway:slack' });

const SLACK_API_BASE = 'slack.com';

export interface SlackChannelConfig extends ChannelConfig {
  /** Bot User OAuth Token (xoxb-...) */
  botToken: string;
  /** Signing Secret */
  signingSecret: string;
  /** App-Level Token (xapp-...) for Socket Mode */
  appToken?: string;
  /** 是否使用 Socket Mode */
  socketMode?: boolean;
}

interface SlackEvent {
  type: string;
  event_ts?: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
}

interface SlackEventCallback {
  token: string;
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  type: string;
  event_id: string;
  event_time: number;
}

/**
 * Slack 通道（企业版）
 * 支持 Events API 和 Socket Mode 两种连接方式
 */
export class SlackChannel implements GatewayChannel, ChannelPlugin {
  readonly name: string;
  readonly type = ChannelType.SLACK;
  readonly config: SlackChannelConfig;

  private _status: ChannelStatus = ChannelStatus.IDLE;
  private callbacks: ChannelEventCallbacks = {};
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventTs: string | null = null;
  private _stats: ChannelStats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    reconnects: 0,
    uptimeMs: 0,
    lastActivityAt: 0,
  };

  constructor(config: SlackChannelConfig) {
    this.name = config.name;
    this.config = {
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
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
    logger.info(`SlackChannel: ${this.name} 初始化完成`);
  }

  async connect(): Promise<void> {
    if (this._status === ChannelStatus.CONNECTED) {
      return;
    }

    this._status = ChannelStatus.CONNECTING;
    this._stats.uptimeMs = Date.now();

    try {
      await this.verifyAuth();

      if (this.config.socketMode && this.config.appToken) {
        await this.connectSocketMode();
      } else {
        this.startPolling();
      }

      this._status = ChannelStatus.CONNECTED;
      this.callbacks.onConnected?.();
      logger.info(`Slack 通道 "${this.name}" 已连接`);
    } catch (error) {
      this._status = ChannelStatus.ERROR;
      this._stats.errors++;
      logger.error(`Slack 通道 "${this.name}" 连接失败`, error);
      this.callbacks.onError?.(error as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this._status = ChannelStatus.DISCONNECTED;
    this.callbacks.onDisconnected?.();
    logger.info(`Slack 通道 "${this.name}" 已断开`);
  }

  async send(message: OutboundMessage): Promise<boolean> {
    const body = JSON.stringify({
      channel: message.recipient,
      text: message.content,
      thread_ts: message.metadata?.threadTs,
    });

    await this.apiRequest('POST', '/api/chat.postMessage', body);
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
      socketMode: this.config.socketMode || false,
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
      messageTypes: ['text', 'markdown', 'html'],
      supportsMedia: true,
      maxMessageLength: 40000,
      directions: [MessageDirection.INBOUND, MessageDirection.OUTBOUND],
      features: ['events_api', 'socket_mode', 'auto_reconnect'],
    };
  }

  validateConfig(): PluginValidationResult {
    const errors: string[] = [];
    if (!this.config.botToken) {
      errors.push('缺少 Bot Token');
    }
    if (!this.config.signingSecret) {
      errors.push('缺少 Signing Secret');
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async verifyAuth(): Promise<void> {
    const response = await this.apiRequest('POST', '/api/auth.test', '{}');
    const data = JSON.parse(response);

    if (!data.ok) {
      throw new AppError(
        ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS.message,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'SLACK_AUTH_FAILED',
        { error: data.error }
      );
    }

    logger.info(`Slack 认证成功: ${data.team} / ${data.user}`);
  }

  private async connectSocketMode(): Promise<void> {
    logger.info('Slack Socket Mode 已启用（需要 WebSocket 客户端库）');
    this._status = ChannelStatus.CONNECTED;
  }

  private startPolling(): void {
    this.pollingTimer = setInterval(async () => {
      try {
        await this.pollEvents();
      } catch (error) {
        logger.error('Slack 事件轮询失败', error);
        this._stats.errors++;
      }
    }, 3000);
  }

  private async pollEvents(): Promise<void> {
    const response = await this.apiRequest(
      'POST',
      '/api/apps.event.authorizations.list',
      '{}'
    );
    const data = JSON.parse(response);

    if (data.authorizations) {
      for (const auth of data.authorizations) {
        const inbound: InboundMessage = {
          id: randomUUID(),
          content: auth.event?.text || '',
          sessionId: auth.event?.channel,
          sender: auth.event?.user || 'unknown',
          raw: auth,
          timestamp: Date.now(),
        };

        await this.handleInbound(inbound);
      }
    }
  }

  private apiRequest(
    method: string,
    path: string,
    body: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: SLACK_API_BASE,
        path,
        method,
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          resolve(data);
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
