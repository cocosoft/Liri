/**
 * WebhookChannel Webhook 通道
 * 对标 Hermes 的 Webhook 通道实现
 */
import { EventEmitter } from 'events';
import http from 'http';
import { createHash } from 'crypto';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
} from '@modules/channels/types';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('channels:webhook:WebhookChannel');

// ── 4.2（P0-2）：webhook 入站真实性校验 ──

/** 时间戳允许窗口（5 分钟），超出视为重放/伪造 */
const WEBHOOK_TS_WINDOW_MS = 5 * 60 * 1000;

/** 防重放缓存：`timestamp_bodyHash` → 首次接收时间（上限 500 条，超限清旧） */
const replayCache = new Map<string, number>();

function cleanupReplayCache(): void {
  const now = Date.now();
  if (replayCache.size > 500) {
    for (const [key, time] of replayCache) {
      if (now - time > WEBHOOK_TS_WINDOW_MS) replayCache.delete(key);
    }
  }
}

export interface WebhookVerifyResult {
  ok: boolean;
  status: number;
  reason?: string;
}

/**
 * 校验 webhook 请求真实性（secret + 时间戳防重放）
 * - secret：`X-Webhook-Token` 或 `Authorization: Bearer <secret>` 与配置一致
 * - 时间戳：`X-Webhook-Timestamp` 在 ±5 分钟窗口内，且同 body 短窗口内不重复
 */
export function verifyWebhookRequest(
  headers: Record<string, string | string[] | undefined>,
  body: string,
  secret?: string
): WebhookVerifyResult {
  if (secret) {
    const raw = headers['x-webhook-token'] ?? headers['authorization'] ?? '';
    const presented = String(raw).replace(/^Bearer\s+/i, '');
    if (!presented || presented !== secret) {
      return { ok: false, status: 401, reason: '无效的 webhook secret' };
    }
  }

  const tsRaw = headers['x-webhook-timestamp'];
  if (tsRaw !== undefined && String(tsRaw).length > 0) {
    const ts = Number(tsRaw);
    if (
      !Number.isFinite(ts) ||
      Math.abs(Date.now() - ts) > WEBHOOK_TS_WINDOW_MS
    ) {
      return { ok: false, status: 401, reason: '请求时间戳超出允许窗口' };
    }
    const replayKey = `${tsRaw}_${createHash('sha256').update(body).digest('hex')}`;
    if (replayCache.has(replayKey)) {
      return { ok: false, status: 409, reason: '检测到重放请求' };
    }
    replayCache.set(replayKey, Date.now());
    cleanupReplayCache();
  }

  return { ok: true, status: 200 };
}

/**
 * Webhook 配置
 */
export interface WebhookConfig {
  enabled: boolean;
  listenPort: number;
  listenHost: string;
  secret?: string;
  path: string;
  endpoints: string[];
  maxRetries: number;
  timeout: number;
}

/**
 * Webhook 消息
 */
export interface WebhookMessage {
  id: string;
  type: 'incoming' | 'outgoing';
  url: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  status?: 'queued' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
}

/**
 * Webhook 通道（遗留 EventEmitter 类，保持向后兼容）
 */
export class WebhookChannel extends EventEmitter {
  private config: WebhookConfig;
  private connected: boolean = false;
  private server: http.Server | null = null;

  constructor(config?: Partial<WebhookConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      listenPort: config?.listenPort || 9100,
      listenHost: config?.listenHost || '0.0.0.0',
      secret: config?.secret,
      path: config?.path || '/webhook',
      endpoints: config?.endpoints || [],
      maxRetries: config?.maxRetries ?? 3,
      timeout: config?.timeout ?? 10000,
    };
  }

  /**
   * 启动 Webhook 服务
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;

    return new Promise((resolve) => {
      try {
        this.server = http.createServer((req, res) => {
          if (req.method === 'POST' && req.url === this.config.path) {
            let body = '';
            req.on('data', (chunk: Buffer) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                // 4.2（P0-2）：webhook 真实性校验（secret + 时间戳防重放）
                const verify = verifyWebhookRequest(
                  req.headers as Record<string, string | string[] | undefined>,
                  body,
                  this.config.secret
                );
                if (!verify.ok) {
                  res.writeHead(verify.status, {
                    'Content-Type': 'application/json',
                  });
                  res.end(
                    JSON.stringify({
                      success: false,
                      error: verify.reason || 'webhook 校验失败',
                    })
                  );
                  return;
                }

                const payload = JSON.parse(body);
                const message: WebhookMessage = {
                  id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  type: 'incoming',
                  url: req.url || '',
                  payload,
                  headers: req.headers as Record<string, string>,
                  status: 'delivered',
                  timestamp: Date.now(),
                };
                this.emit('message:received', message);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({ success: true, messageId: message.id })
                );
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({ success: false, error: 'Invalid JSON' })
                );
              }
            });
          } else {
            res.writeHead(404);
            res.end();
          }
        });

        this.server.listen(
          this.config.listenPort,
          this.config.listenHost,
          () => {
            this.connected = true;
            this.emit('connected', {
              host: this.config.listenHost,
              port: this.config.listenPort,
            });
            resolve(true);
          }
        );
      } catch (err) {
        handleError(err, { module: 'channels:webhook', action: 'connect' });
        this.emit('error', err);
        resolve(false);
      }
    });
  }

  /**
   * 停止 Webhook 服务
   */
  async disconnect(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          this.connected = false;
          this.emit('disconnected', {});
          resolve();
        });
      });
    }
    this.connected = false;
  }

  /**
   * 发送 Webhook（向外部端点发送数据）
   */
  async sendMessage(target: string, text: string): Promise<boolean> {
    if (!this.connected && this.config.endpoints.length === 0) return false;

    const payload = { text, timestamp: Date.now(), source: 'Liri' };

    const message: WebhookMessage = {
      id: `wh-out-${Date.now()}`,
      type: 'outgoing',
      url: target,
      payload,
      headers: { 'Content-Type': 'application/json' },
      status: 'queued',
      timestamp: Date.now(),
    };

    this.emit('message:sent', message);

    return true;
  }

  /**
   * 向所有配置的端点广播
   */
  async broadcast(text: string): Promise<number> {
    let successCount = 0;

    for (const endpoint of this.config.endpoints) {
      const ok = await this.sendMessage(endpoint, text);
      if (ok) successCount++;
    }

    return successCount;
  }

  /**
   * 获取通道状态
   */
  getStatus(): Record<string, unknown> {
    return {
      name: 'webhook',
      type: 'webhook',
      enabled: this.config.enabled,
      connected: this.connected,
      listenPort: this.config.listenPort,
      path: this.config.path,
      endpoints: this.config.endpoints.length,
    };
  }
}

export const webhookChannel = new WebhookChannel();

const WEBHOOK_META: ChannelMeta = {
  id: 'webhook',
  displayName: 'Webhook',
  vendor: 'Webhook',
  vendorSite: '',
  icon: 'webhook',
  markdownCapable: false,
  maxMessageLength: 50000,
  supportedMessageTypes: ['text'],
};

const WEBHOOK_CAPABILITIES: ChannelCapabilities = {
  directMessage: false,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: true,
};

class WebhookChannelPlugin extends BaseChannelPlugin {
  readonly id = 'webhook';
  readonly meta = WEBHOOK_META;
  readonly capabilities = WEBHOOK_CAPABILITIES;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['url'] as string) || 'unknown',
        displayName: 'Webhook',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      listenPort: 9100,
      listenHost: '0.0.0.0',
      path: '/webhook',
      endpoints: [],
      secret: '',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['listenPort']) errors.push('缺少 listenPort');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await webhookChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await webhookChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await webhookChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:webhook',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'Webhook: 不支持图片' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Webhook: 不支持文件' };
  }
}

export function createWebhookChannel(): IChannelPlugin {
  return new WebhookChannelPlugin();
}

export const webhookChannelPlugin = createWebhookChannel();
