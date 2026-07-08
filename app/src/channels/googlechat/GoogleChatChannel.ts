import crypto from 'crypto';
import http from 'http';
import { randomUUID } from 'crypto';
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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { TTLCache } from '@modules/utils/cache';

const GOOGLE_CHAT_API_BASE = 'https://chat.googleapis.com/v1';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';

const GOOGLECHAT_META: ChannelMeta = {
  id: 'googlechat',
  displayName: 'Google Chat',
  vendor: 'Google',
  vendorSite: 'https://chat.google.com',
  icon: '💬',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'markdown', 'image', 'file', 'card'],
};

const GOOGLECHAT_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

/**
 * base64url 编码
 */
function base64UrlEncode(data: Buffer): string {
  return data
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * 使用私钥对数据进行 RSA-SHA256 签名
 */
function signJwt(privateKeyPem: string, payload: string): string {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(payload);
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

/**
 * 生成 Google 服务账号 JWT
 */
function createServiceAccountJwt(
  clientEmail: string,
  privateKey: string,
  scope: string
): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const headerEncoded = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const claimEncoded = base64UrlEncode(Buffer.from(JSON.stringify(claim)));
  const signature = signJwt(privateKey, `${headerEncoded}.${claimEncoded}`);

  return `${headerEncoded}.${claimEncoded}.${base64UrlEncode(Buffer.from(signature))}`;
}

/**
 * 通过服务账号 JWT 换取 Google API Access Token
 */
async function getGoogleChatAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string> {
  const jwt = createServiceAccountJwt(
    clientEmail,
    privateKey,
    GOOGLE_CHAT_SCOPE
  );

  const resp = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google OAuth 失败: ${resp.status} ${errText}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const token = data['access_token'] as string;
  if (!token) throw new Error('Google OAuth 返回缺少 access_token');
  return token;
}

/**
 * 消息去重（基于 sender + space + text 组合，5 秒窗口）
 */
class GoogleChatDedup {
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

class GoogleChatChannelPlugin extends BaseChannelPlugin {
  readonly id = 'googlechat';
  readonly meta = GOOGLECHAT_META;
  readonly capabilities = GOOGLECHAT_CAPABILITIES;

  private clientEmail = '';
  private privateKey = '';
  private spaceIds: string[] = [];
  private webhookPort = 8088;
  private webhookServer: http.Server | null = null;
  private dedup = new GoogleChatDedup();

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['senderName'] as string) || 'unknown',
        displayName: (sender['senderDisplayName'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      clientEmail: '',
      privateKey: '',
      spaceIds: [],
      webhookPort: 8088,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['clientEmail']) errors.push('缺少 clientEmail（服务账号邮箱）');
    if (!config['privateKey']) errors.push('缺少 privateKey（服务账号私钥）');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.clientEmail = (config['clientEmail'] as string) || '';
    this.privateKey = (config['privateKey'] as string) || '';
    this.spaceIds = (config['spaceIds'] as string[]) || [];
    this.webhookPort = (config['webhookPort'] as number) || 8088;
    this.dedup.clear();

    // 验证凭据
    const token = await getGoogleChatAccessToken(
      this.clientEmail,
      this.privateKey
    );
    if (!token) {
      throw new AppError(
        'Google Chat 认证失败',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'AUTH_FAILED',
        { channel: 'googlechat' }
      );
    }

    this.logger.info('Google Chat 通道已连接', {
      clientEmail: this.clientEmail,
      spaces: this.spaceIds,
    });
  }

  protected override async onDisconnect(): Promise<void> {
    // Webhook 服务器由 inbound adapter 管理
  }

  /**
   * 获取 Google Chat API 的 headers（含 Bearer Token）
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getGoogleChatAccessToken(
      this.clientEmail,
      this.privateKey
    );
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * 发起带认证的 Google Chat API 请求
   */
  private async apiPost(
    path: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const headers = await this.getAuthHeaders();
      const url = `${GOOGLE_CHAT_API_BASE}/${path}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = resp.ok
        ? ((await resp.json()) as Record<string, unknown>)
        : undefined;
      const error = resp.ok
        ? undefined
        : `Google Chat API ${resp.status}: ${await resp.text()}`;
      return { ok: resp.ok, data, error };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const space = target.startsWith('spaces/') ? target : `spaces/${target}`;
    const result = await this.apiPost(`${space}/messages`, { text: content });
    return {
      success: result.ok,
      error: result.error,
      messageId: result.data?.['name'] as string,
    };
  }

  protected async sendImageMessage(
    target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    // Google Chat API 图片消息需要通过附件上传后引用
    return {
      success: false,
      error: 'GoogleChat: 图片消息请使用 sendFile 先上传附件',
    };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    try {
      const fs = await import('node:fs');
      const path = await import('path');
      const buffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);

      const space = target.startsWith('spaces/') ? target : `spaces/${target}`;
      const token = await getGoogleChatAccessToken(
        this.clientEmail,
        this.privateKey
      );
      const boundary = `pyapp-${randomUUID()}`;

      const metadata = JSON.stringify({ filename: fileName });
      const headerPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
      const mediaHeader = `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;

      const body = Buffer.concat([
        Buffer.from(headerPart, 'utf8'),
        Buffer.from(mediaHeader, 'utf8'),
        buffer,
        Buffer.from(footer, 'utf8'),
      ]);

      const uploadUrl = `https://chat.googleapis.com/upload/v1/${space}/attachments:upload?uploadType=multipart`;
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });

      if (!resp.ok) {
        return {
          success: false,
          error: `Google Chat 上传失败: ${resp.status}`,
        };
      }

      const uploadData = (await resp.json()) as Record<string, unknown>;
      const attachmentToken = (
        uploadData['attachmentDataRef'] as Record<string, unknown>
      )?.['attachmentUploadToken'] as string;

      if (!attachmentToken) {
        return {
          success: false,
          error: 'Google Chat 上传返回缺少 attachmentUploadToken',
        };
      }

      const msgResult = await this.apiPost(`${space}/messages`, {
        text: fileName,
        attachment: [
          { attachmentDataRef: { attachmentUploadToken: attachmentToken } },
        ],
      });

      return {
        success: msgResult.ok,
        error: msgResult.error,
        messageId: msgResult.data?.['name'] as string,
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const space = target.startsWith('spaces/') ? target : `spaces/${target}`;
    const cards: Record<string, unknown>[] = [
      {
        header: {
          title: card.title,
          subtitle: '',
        },
        sections: [
          {
            widgets: [
              {
                textParagraph: { text: card.content },
              },
              ...(card.buttons || []).map((btn) => ({
                buttonList: {
                  buttons: [
                    {
                      text: btn.text,
                      onClick: {
                        openLink: { url: btn.value },
                      },
                    },
                  ],
                },
              })),
            ],
          },
        ],
      },
    ];

    const result = await this.apiPost(`${space}/messages`, { cards });
    return {
      success: result.ok,
      error: result.error,
      messageId: result.data?.['name'] as string,
    };
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await getGoogleChatAccessToken(this.clientEmail, this.privateKey);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  /**
   * 创建入站适配器（Webhook HTTP 服务器）
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'webhook' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        if (self.webhookServer) {
          self.logger.warn('Google Chat Webhook 服务器已在运行');
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
            // Google Chat 需要立即返回 200 确认
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));

            try {
              const parsed = JSON.parse(body) as Record<string, unknown>;

              // Google Chat 验证请求
              if (parsed['type'] === 'CARD_CLICKED') {
                return;
              }

              const space = parsed['space'] as
                | Record<string, unknown>
                | undefined;
              const message = parsed['message'] as
                | Record<string, unknown>
                | undefined;
              const sender = parsed['user'] as
                | Record<string, unknown>
                | undefined;
              const eventTime = parsed['eventTime'] as string;

              if (!message || !sender) return;

              const spaceName = (space?.['name'] as string) || '';
              const text =
                ((message['text'] as string) || '').replace(/<[^>]+>/g, '') ||
                '';
              const senderName = (sender['displayName'] as string) || '';
              const senderId = (sender['name'] as string) || '';
              const messageId = randomUUID();

              // 去重
              const dedupKey = `${senderId}:${spaceName}:${text}`;
              if (!self.dedup.claim(dedupKey)) return;

              const ctx: MessageContext = {
                channelId: 'googlechat',
                senderId,
                senderName,
                groupId: spaceName,
                conversationId: spaceName,
                messageId,
                messageType: 'text',
                content: text,
                timestamp: new Date(eventTime || Date.now()).getTime(),
                isDirectMessage: false,
                rawPayload: parsed,
              };

              self.handleIncomingMessage(ctx).catch((err) => {
                self.logger.error('Google Chat 消息处理异常', {
                  error: String(err),
                });
              });
            } catch {
              self.logger.warn('Google Chat Webhook 消息解析失败');
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          self.webhookServer!.listen(self.webhookPort, () => {
            self.logger.info(
              `Google Chat Webhook 已启动 (端口: ${self.webhookPort})`
            );
            self.setInboundListening(true);
            resolve();
          });
          self.webhookServer!.on('error', (err: Error) => {
            self.logger.error('Google Chat Webhook 启动失败', {
              error: String(err),
            });
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
        self.logger.info('Google Chat Webhook 已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }
}

export function createGoogleChatChannel(): IChannelPlugin {
  return new GoogleChatChannelPlugin();
}

export const googleChatChannelPlugin = createGoogleChatChannel();
