/**
 * TelegramChannel — Telegram Bot 通道适配器
 * @deprecated 请使用 channels/telegram/ 下的 IChannelPlugin 实现
 *             core/gateway/ 体系后续将统一收敛到 channels/ 体系
 * 使用 Node.js 内置 https 模块通过长轮询接收/发送消息
 */

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

/** Telegram Bot API 基础 URL */
const TELEGRAM_API_BASE = 'api.telegram.org';

/** Telegram 通道配置 */
export interface TelegramChannelConfig extends ChannelConfig {
  /** Bot Token */
  token: string;
  /** 轮询超时（秒） */
  pollingTimeout?: number;
  /** 轮询间隔（毫秒） */
  pollingInterval?: number;
}

/** Telegram 更新对象 */
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

/** Telegram 消息对象 */
interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    is_bot?: boolean;
  };
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

/** Telegram 发送响应 */
interface TelegramSendResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

/**
 * Telegram Bot 通道
 * 通过长轮询接收消息，通过 Bot API 发送消息
 */
export class TelegramChannel implements GatewayChannel, ChannelPlugin {
  readonly name: string;
  readonly type = ChannelType.TELEGRAM;
  readonly config: TelegramChannelConfig;

  private _status: ChannelStatus = ChannelStatus.IDLE;
  private _callbacks: ChannelEventCallbacks = {};
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateId = 0;
  private isPolling = false;
  private _startTime = 0;
  private _messagesReceived = 0;
  private _messagesSent = 0;
  private _errors = 0;
  private _reconnects = 0;

  constructor(config: TelegramChannelConfig) {
    this.name = config.name;
    this.config = {
      pollingTimeout: 30,
      pollingInterval: 1000,
      ...config,
    };
  }

  get status(): ChannelStatus {
    return this._status;
  }

  get stats(): ChannelStats {
    return {
      messagesReceived: this._messagesReceived,
      messagesSent: this._messagesSent,
      errors: this._errors,
      reconnects: this._reconnects,
      uptimeMs: this._startTime > 0 ? Date.now() - this._startTime : 0,
      lastActivityAt: Date.now(),
    };
  }

  async initialize(): Promise<void> {
    logger.info(`TelegramChannel: ${this.name} 初始化完成`);
  }

  async connect(): Promise<void> {
    if (
      this._status === ChannelStatus.CONNECTED ||
      this._status === ChannelStatus.CONNECTING
    ) {
      return;
    }

    this.setStatus(ChannelStatus.CONNECTING);

    try {
      const me = await this.apiCall<{ id: number; username: string }>('getMe');
      logger.info(
        `TelegramChannel: ${this.name} 已连接 (Bot: @${me.username})`
      );

      this._startTime = Date.now();
      this.setStatus(ChannelStatus.CONNECTED);
      this._callbacks.onConnected?.();

      this.startPolling();
    } catch (error) {
      this.setStatus(ChannelStatus.ERROR);
      const err = error instanceof Error ? error : new Error(String(error));
      this._errors++;
      this._callbacks.onError?.(err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.isPolling = false;

    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.setStatus(ChannelStatus.DISCONNECTED);
    this._callbacks.onDisconnected?.('用户断开');
    logger.info(`TelegramChannel: ${this.name} 已断开`);
  }

  async send(message: OutboundMessage): Promise<boolean> {
    const chatId = message.recipient;

    try {
      const parseMode = this.getParseMode(message.type);

      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: message.content,
      };

      if (parseMode) {
        body.parse_mode = parseMode;
      }

      await this.apiCall<TelegramSendResponse>('sendMessage', body);
      this._messagesSent++;
      return true;
    } catch (error) {
      this._errors++;
      logger.error(`TelegramChannel: 发送消息失败 — ${chatId}`, {
        error: String(error),
      });
      return false;
    }
  }

  isConnected(): boolean {
    return this._status === ChannelStatus.CONNECTED;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.apiCall<{ id: number }>('getMe');
      return true;
    } catch {
      return false;
    }
  }

  setCallbacks(callbacks: ChannelEventCallbacks): void {
    this._callbacks = callbacks;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      status: this._status,
      isPolling: this.isPolling,
      lastUpdateId: this.lastUpdateId,
      uptimeMs: this._startTime > 0 ? Date.now() - this._startTime : 0,
      messagesReceived: this._messagesReceived,
      messagesSent: this._messagesSent,
      errors: this._errors,
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
    this._messagesReceived++;
    this._callbacks.onMessage?.(message);
  }

  async handleOutbound(message: OutboundMessage): Promise<boolean> {
    return this.send(message);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      messageTypes: ['text', 'markdown', 'html'],
      supportsMedia: false,
      maxMessageLength: 4096,
      directions: [MessageDirection.INBOUND, MessageDirection.OUTBOUND],
      features: ['polling', 'auto_reconnect'],
    };
  }

  validateConfig(): PluginValidationResult {
    const errors: string[] = [];
    if (!this.config.token) {
      errors.push('缺少 Bot Token');
    }
    if (
      !this.config.token?.startsWith?.('/') &&
      this.config.token &&
      this.config.token.split(':').length < 2
    ) {
      errors.push('Bot Token 格式无效（需要 bot_token:数字格式）');
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 开始长轮询
   */
  private startPolling(): void {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    this.pollLoop();
  }

  /**
   * 轮询循环
   */
  private async pollLoop(): Promise<void> {
    if (!this.isPolling) {
      return;
    }

    try {
      const params: Record<string, unknown> = {
        timeout: this.config.pollingTimeout,
        allowed_updates: ['message', 'edited_message'],
      };

      if (this.lastUpdateId > 0) {
        params.offset = this.lastUpdateId + 1;
      }

      const updates = await this.apiCall<TelegramUpdate[]>(
        'getUpdates',
        params
      );

      for (const update of updates) {
        this.lastUpdateId = update.update_id;
        this.processUpdate(update);
      }
    } catch (error) {
      this._errors++;
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`TelegramChannel: 轮询错误`, { error: err.message });
      this._callbacks.onError?.(err);
    }

    this.pollingTimer = setTimeout(() => {
      this.pollLoop();
    }, this.config.pollingInterval);
  }

  /**
   * 处理 Telegram 更新
   */
  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) {
      return;
    }

    const senderName = msg.from?.username
      ? `@${msg.from.username}`
      : msg.from
        ? `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim()
        : `user_${msg.chat.id}`;

    const inboundMessage: InboundMessage = {
      id: `tg_${msg.message_id}_${Date.now()}`,
      content: msg.text,
      sessionId: `tg_${msg.chat.id}`,
      sender: String(msg.chat.id),
      raw: {
        messageId: msg.message_id,
        chatId: msg.chat.id,
        chatType: msg.chat.type,
        senderId: msg.from?.id,
        senderName,
        date: msg.date,
      },
      timestamp: msg.date * 1000,
    };

    await this.handleInbound(inboundMessage);
  }

  /**
   * 调用 Telegram Bot API
   */
  private apiCall<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const body = params ? JSON.stringify(params) : '';
      const urlPath = `/bot${this.config.token}/${method}`;

      const options: https.RequestOptions = {
        hostname: TELEGRAM_API_BASE,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: (this.config.pollingTimeout! + 5) * 1000,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk: string) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);

            if (parsed.ok) {
              resolve(parsed.result as T);
            } else {
              reject(
                new Error(
                  `Telegram API 错误: ${parsed.description || '未知错误'}`
                )
              );
            }
          } catch (e) {
            reject(new Error(`解析响应失败: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Telegram API 请求失败: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        if (method === 'getUpdates') {
          resolve([] as unknown as T);
        } else {
          reject(new Error('请求超时'));
        }
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * 获取解析模式
   */
  private getParseMode(type?: string): string | undefined {
    switch (type) {
      case 'markdown':
        return 'MarkdownV2';
      case 'html':
        return 'HTML';
      default:
        return undefined;
    }
  }

  /**
   * 设置状态
   */
  private setStatus(status: ChannelStatus): void {
    const previous = this._status;
    if (previous !== status) {
      this._status = status;
      this._callbacks.onStateChange?.(status, previous);
    }
  }
}
