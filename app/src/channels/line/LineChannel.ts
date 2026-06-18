import crypto from 'node:crypto';
import http from 'node:http';
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
import { TTLCache } from '@modules/utils/cache';

const LINE_API_BASE = 'https://api.line.me/v2/bot';

const LINE_META: ChannelMeta = {
  id: 'line',
  displayName: 'LINE',
  vendor: 'LINE Corporation',
  vendorSite: 'https://line.me',
  icon: 'line',
  markdownCapable: false,
  maxMessageLength: 5000,
  supportedMessageTypes: ['text', 'image', 'file', 'card'],
};

const LINE_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

/**
 * LINE Webhook 签名验证
 */
function verifyLineSignature(
  channelSecret: string,
  body: string,
  signature: string
): boolean {
  const hmac = crypto.createHmac('SHA256', channelSecret);
  hmac.update(body);
  const expected = hmac.digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * 消息去重（基于 messageId，5 秒窗口）
 */
class LineDedup {
  private cache = new TTLCache<number>(10000, 5000);

  claim(key: string): boolean {
    if (this.cache.has(key)) return false;
    this.cache.set(key, Date.now());
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * 用户档案缓存（5 分钟 TTL）
 */
class UserProfileCache {
  private cache = new TTLCache<string>(10000, 5 * 60 * 1000);
  private channelAccessToken = '';

  setChannelAccessToken(token: string): void {
    this.channelAccessToken = token;
  }

  async get(userId: string): Promise<string> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    try {
      const resp = await fetch(`${LINE_API_BASE}/profile/${userId}`, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>;
        const name = (data['displayName'] as string) || userId;
        this.cache.set(userId, name);
        return name;
      }
    } catch {
      // 静默降级
    }
    return userId;
  }
}

/**
 * Reply Token 管理器
 */
class ReplyTokenManager {
  private tokens = new Map<string, string>();

  set(conversationId: string, replyToken: string): void {
    this.tokens.set(conversationId, replyToken);
  }

  get(conversationId: string): string | undefined {
    return this.tokens.get(conversationId);
  }

  delete(conversationId: string): void {
    this.tokens.delete(conversationId);
  }
}

class LineChannelPlugin extends BaseChannelPlugin {
  readonly id = 'line';
  readonly meta = LINE_META;
  readonly capabilities = LINE_CAPABILITIES;

  private channelAccessToken = '';
  private channelSecret = '';
  private webhookPort = 8086;
  private webhookServer: http.Server | null = null;
  private dedup = new LineDedup();
  private profileCache = new UserProfileCache();
  private replyTokens = new ReplyTokenManager();

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['userId'] as string) || 'unknown',
        displayName: (sender['displayName'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      channelAccessToken: '',
      channelSecret: '',
      webhookPort: 8086,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['channelAccessToken']) errors.push('缺少 channelAccessToken');
    if (!config['channelSecret'])
      errors.push('缺少 channelSecret（用于 Webhook 签名验证）');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.channelAccessToken = (config['channelAccessToken'] as string) || '';
    this.channelSecret = (config['channelSecret'] as string) || '';
    this.webhookPort = (config['webhookPort'] as number) || 8086;
    this.dedup.clear();
    this.profileCache.setChannelAccessToken(this.channelAccessToken);

    this.logger.info('LINE 通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {}

  /**
   * 向 LINE Messaging API 发送消息
   */
  private async linePost(
    path: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const resp = await fetch(`${LINE_API_BASE}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.channelAccessToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = resp.ok
        ? ((await resp.json()) as Record<string, unknown>)
        : undefined;
      const error = resp.ok
        ? undefined
        : `LINE API ${resp.status}: ${await resp.text()}`;
      return { ok: resp.ok, data, error };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const result = await this.linePost('message/push', {
      to: target,
      messages: [{ type: 'text', text: content }],
    });
    return { success: result.ok, error: result.error };
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    const result = await this.linePost('message/push', {
      to: target,
      messages: [
        {
          type: 'image',
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        },
      ],
    });
    return { success: result.ok, error: result.error };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return {
      success: false,
      error: 'LINE: 不支持通用文件推送',
    };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    // 使用 Buttons Template 实现交互卡片
    const result = await this.linePost('message/push', {
      to: target,
      messages: [
        {
          type: 'template',
          altText: card.title,
          template: {
            type: 'buttons',
            title: card.title,
            text: card.content,
            actions: (card.buttons || []).map((btn) => ({
              type: 'uri',
              label: btn.text,
              uri: btn.value,
            })),
          },
        },
      ],
    });
    return { success: result.ok, error: result.error };
  }

  /**
   * 使用 Reply Token 回复消息（仅可在 Webhook 上下文中使用）
   */
  async sendReply(replyToken: string, text: string): Promise<boolean> {
    try {
      const resp = await fetch(`${LINE_API_BASE}/message/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.channelAccessToken}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: 'text', text }],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        this.logger.warn(`LINE reply API 错误: ${resp.status} ${errText}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`LINE reply 失败: ${e}`);
      return false;
    }
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const resp = await fetch(`${LINE_API_BASE}/info`, {
        headers: { Authorization: `Bearer ${this.channelAccessToken}` },
      });
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'webhook' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        if (self.webhookServer) {
          self.logger.warn('LINE Webhook 服务器已在运行');
          return;
        }

        self.webhookServer = http.createServer((req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405);
            res.end();
            return;
          }

          let body = '';
          req.on('data', (chunk: string) => {
            body += chunk;
          });

          req.on('end', () => {
            // 验证 X-Line-Signature
            const signature = req.headers['x-line-signature'] as string;
            if (
              !signature ||
              !verifyLineSignature(self.channelSecret, body, signature)
            ) {
              self.logger.warn('LINE Webhook 签名验证失败');
              res.writeHead(401);
              res.end('Unauthorized');
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));

            try {
              const parsed = JSON.parse(body) as Record<string, unknown>;
              const events = parsed['events'] as
                | Array<Record<string, unknown>>
                | undefined;
              if (!events) return;

              for (const event of events) {
                const eventType = event['type'] as string;
                if (eventType !== 'message') continue;

                const message = event['message'] as Record<string, unknown>;
                const source = event['source'] as Record<string, unknown>;
                const sourceType = source['type'] as string;
                const msgType = message['type'] as string;
                const messageId = String(message['id'] || '');

                // 去重
                if (!self.dedup.claim(messageId)) continue;

                if (msgType !== 'text') continue;

                const userId = String(source['userId'] || '');

                // 缓存 Reply Token
                const replyToken = event['replyToken'] as string;
                if (replyToken) {
                  self.replyTokens.set(userId, replyToken);
                }

                // 异步获取用户档案
                self.profileCache.get(userId).then((name) => {
                  const ctx: MessageContext = {
                    channelId: 'line',
                    senderId: userId,
                    senderName: name,
                    groupId:
                      sourceType === 'group'
                        ? String(source['groupId'] || '')
                        : undefined,
                    conversationId: userId,
                    messageId,
                    messageType: 'text',
                    content: String(message['text'] || ''),
                    timestamp: (event['timestamp'] as number) || Date.now(),
                    isDirectMessage: sourceType === 'user',
                    rawPayload: event,
                  };

                  self.handleIncomingMessage(ctx).catch((err) => {
                    self.logger.error('LINE 消息处理异常', {
                      error: String(err),
                    });
                  });
                });
              }
            } catch {
              self.logger.warn('LINE Webhook 消息解析失败');
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          self.webhookServer!.listen(self.webhookPort, () => {
            self.logger.info(`LINE Webhook 已启动 (端口: ${self.webhookPort})`);
            self.setInboundListening(true);
            resolve();
          });
          self.webhookServer!.on('error', (err: Error) => {
            self.logger.error('LINE Webhook 启动失败', { error: String(err) });
            reject(err);
          });
        });
      },

      stop: async (): Promise<void> => {
        if (self.webhookServer) {
          await new Promise<void>((resolve) => {
            self.webhookServer!.close(() => resolve());
          });
          self.webhookServer = null;
        }
        self.setInboundListening(false);
        self.logger.info('LINE Webhook 已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }
}

export function createLineChannel(): IChannelPlugin {
  return new LineChannelPlugin();
}

export const lineChannelPlugin = createLineChannel();
