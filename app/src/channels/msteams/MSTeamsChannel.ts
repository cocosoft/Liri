import crypto from 'node:crypto';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
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
import { handleError } from '@modules/error';
import { TTLCache } from '@modules/utils/cache';
import { Logger, LogLevel } from '@modules/monitoring';
import path from 'node:path';
import { resolveDataDir } from '@modules/core';

const MICROSOFT_LOGIN_BASE = 'https://login.microsoftonline.com';
const BOT_FRAMEWORK_BASE = 'https://smba.trafficmanager.net/amer';
const BOT_FRAMEWORK_SCOPE = 'https://api.botframework.com/.default';
const BOT_FRAMEWORK_OPENID_CONFIG =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';

const MSTEAMS_META: ChannelMeta = {
  id: 'msteams',
  displayName: 'Microsoft Teams',
  vendor: 'Microsoft',
  vendorSite: 'https://teams.microsoft.com',
  icon: '💼',
  markdownCapable: true,
  maxMessageLength: 28672,
  supportedMessageTypes: ['text', 'markdown', 'image', 'file', 'card'],
};

const MSTEAMS_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

/**
 * 获取 Microsoft Identity Platform Access Token（客户端凭证模式）
 */
async function getMsTeamsAccessToken(
  tenantId: string,
  appId: string,
  appPassword: string
): Promise<string> {
  const url = `${MICROSOFT_LOGIN_BASE}/${tenantId}/oauth2/v2.0/token`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appPassword,
      scope: BOT_FRAMEWORK_SCOPE,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`MS Teams OAuth 失败: ${resp.status} ${errText}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const token = data['access_token'] as string;
  if (!token) throw new Error('MS Teams OAuth 返回缺少 access_token');
  return token;
}

/**
 * Bot Framework JWT 验证（通过公开 JWKS）
 */
async function verifyBotFrameworkJwt(
  token: string
): Promise<{ verified: boolean; issuer?: string; audience?: string }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { verified: false };

    const header = JSON.parse(
      Buffer.from(parts[0]!, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const kid = header['kid'] as string;
    if (!kid) return { verified: false };

    // 获取 OpenID 配置
    const configResp = await fetch(BOT_FRAMEWORK_OPENID_CONFIG);
    if (!configResp.ok) return { verified: false };
    const configData = (await configResp.json()) as Record<string, unknown>;
    const jwksUri = configData['jwks_uri'] as string;
    if (!jwksUri) return { verified: false };

    // 获取 JWKS
    const jwksResp = await fetch(jwksUri);
    if (!jwksResp.ok) return { verified: false };
    const jwksData = (await jwksResp.json()) as Record<string, unknown>;
    const keys = jwksData['keys'] as Array<Record<string, unknown>>;
    const key = keys?.find((k) => k['kid'] === kid);
    if (!key) return { verified: false };

    // 使用 x5c 证书验证签名
    const x5c = key['x5c'] as string[] | undefined;
    if (!x5c?.length) return { verified: false };

    const certPem = `-----BEGIN CERTIFICATE-----\n${x5c[0]!.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(`${parts[0]}.${parts[1]}`);
    verify.end();

    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    return {
      verified: verify.verify(certPem, parts[2]!, 'base64url'),
      issuer: payload['iss'] as string,
      audience: payload['aud'] as string,
    };
  } catch {
    return { verified: false };
  }
}

/**
 * 消息去重（基于 activityId + conversationId 组合，5 秒窗口）
 */
class MSTeamsDedup {
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
 * ConversationReference 存储（内存 Map + 文件持久化）
 */
class ConversationStore {
  private refs = new Map<string, Record<string, unknown>>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const storePath = this.getStorePath();
      if (fs.existsSync(storePath)) {
        const data = JSON.parse(fs.readFileSync(storePath, 'utf8')) as Record<
          string,
          unknown
        >;
        for (const [key, val] of Object.entries(data)) {
          this.refs.set(key, val as Record<string, unknown>);
        }
      }
    } catch {
      // 首次启动无文件是正常的
    }
    this.initialized = true;
  }

  private getStorePath(): string {
    const path = require('node:path') as typeof import('node:path');
    return path.join(resolveDataDir(), 'msteams-conversations.json');
  }

  private async persist(): Promise<void> {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const storePath = this.getStorePath();
      const dir = path.dirname(storePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        storePath,
        JSON.stringify(Object.fromEntries(this.refs), null, 2),
        'utf8'
      );
    } catch {
      // 文件持久化失败不应阻塞
    }
  }

  set(conversationId: string, ref: Record<string, unknown>): void {
    this.refs.set(conversationId, ref);
    this.persist().catch(() => {});
  }

  get(conversationId: string): Record<string, unknown> | undefined {
    return this.refs.get(conversationId);
  }

  getAll(): Record<string, unknown>[] {
    return Array.from(this.refs.values());
  }
}

class MSTeamsChannelPlugin extends BaseChannelPlugin {
  readonly id = 'msteams';
  readonly meta = MSTEAMS_META;
  readonly capabilities = MSTEAMS_CAPABILITIES;

  private tenantId = '';
  private appId = '';
  private appPassword = '';
  private serviceUrl = BOT_FRAMEWORK_BASE;
  private webhookPort = 8089;
  private webhookServer: http.Server | null = null;
  private dedup = new MSTeamsDedup();
  private convStore = new ConversationStore();

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId:
          (sender['aadObjectId'] as string) ||
          (sender['id'] as string) ||
          'unknown',
        displayName: (sender['name'] as string) || 'Unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      tenantId: '',
      appId: '',
      appPassword: '',
      webhookPort: 8089,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['tenantId']) errors.push('缺少 tenantId（Azure AD 租户 ID）');
    if (!config['appId']) errors.push('缺少 appId（Bot Framework App ID）');
    if (!config['appPassword'])
      errors.push('缺少 appPassword（Bot Framework 客户端密码）');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.tenantId = (config['tenantId'] as string) || '';
    this.appId = (config['appId'] as string) || '';
    this.appPassword = (config['appPassword'] as string) || '';
    this.webhookPort = (config['webhookPort'] as number) || 8089;
    this.dedup.clear();

    await this.convStore.init();

    // 验证凭据
    const token = await getMsTeamsAccessToken(
      this.tenantId,
      this.appId,
      this.appPassword
    );
    if (!token) {
      throw new AppError(
        'MS Teams 认证失败',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'AUTH_FAILED',
        { channel: 'msteams', tenantId: this.tenantId }
      );
    }

    this.logger.info('MS Teams 通道已连接', {
      appId: this.appId,
      tenantId: this.tenantId,
    });
  }

  protected override async onDisconnect(): Promise<void> {
    // Webhook 服务器由 inbound adapter 管理
  }

  /**
   * 向 Bot Framework API 发送 Activity
   */
  private async sendActivity(
    conversationId: string,
    activity: Record<string, unknown>
  ): Promise<{ ok: boolean; activityId?: string; error?: string }> {
    try {
      const token = await getMsTeamsAccessToken(
        this.tenantId,
        this.appId,
        this.appPassword
      );
      const url = `${this.serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(activity),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return {
          ok: false,
          error: `Bot Framework API ${resp.status}: ${errText}`,
        };
      }

      const data = (await resp.json()) as Record<string, unknown>;
      return {
        ok: true,
        activityId: data['id'] as string,
      };
    } catch (e) {
      await handleError(e, {
        module: 'channels:msteams',
        action: 'sendActivity',
        context: { conversationId },
      });
      return { ok: false, error: String(e) };
    }
  }

  /**
   * 获取服务 URL（基于存储的 reference）
   */
  private getServiceUrl(conversationId: string): string {
    const ref = this.convStore.get(conversationId);
    return (ref?.['serviceUrl'] as string) || this.serviceUrl;
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    this.serviceUrl = this.getServiceUrl(target);

    const activity: Record<string, unknown> = {
      type: 'message',
      text: content,
      textFormat: 'plain',
      timestamp: new Date().toISOString(),
      from: { id: this.appId, name: 'Liri Bot' },
    };

    const result = await this.sendActivity(target, activity);
    return {
      success: result.ok,
      error: result.error,
      messageId: result.activityId,
    };
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    this.serviceUrl = this.getServiceUrl(target);

    const activity: Record<string, unknown> = {
      type: 'message',
      text: '',
      attachments: [
        {
          contentType: 'image/png',
          contentUrl: imageUrl,
          name: 'image',
        },
      ],
      from: { id: this.appId, name: 'Liri Bot' },
    };

    const result = await this.sendActivity(target, activity);
    return {
      success: result.ok,
      error: result.error,
      messageId: result.activityId,
    };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const buffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const base64 = buffer.toString('base64');

      this.serviceUrl = this.getServiceUrl(target);

      const activity: Record<string, unknown> = {
        type: 'message',
        text: fileName,
        attachments: [
          {
            contentType: 'application/octet-stream',
            contentUrl: `data:application/octet-stream;base64,${base64}`,
            name: fileName,
          },
        ],
        from: { id: this.appId, name: 'Liri Bot' },
      };

      const result = await this.sendActivity(target, activity);
      return {
        success: result.ok,
        error: result.error,
        messageId: result.activityId,
      };
    } catch (e) {
      await handleError(e, {
        module: 'channels:msteams',
        action: 'sendFileMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    this.serviceUrl = this.getServiceUrl(target);

    const activity: Record<string, unknown> = {
      type: 'message',
      text: card.content,
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: card.title,
                weight: 'bolder',
                size: 'medium',
              },
              {
                type: 'TextBlock',
                text: card.content,
                wrap: true,
              },
            ],
            actions: (card.buttons || []).map((btn) => ({
              type: 'Action.OpenUrl',
              title: btn.text,
              url: btn.value,
            })),
          },
        },
      ],
      from: { id: this.appId, name: 'Liri Bot' },
    };

    const result = await this.sendActivity(target, activity);
    return {
      success: result.ok,
      error: result.error,
      messageId: result.activityId,
    };
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await getMsTeamsAccessToken(this.tenantId, this.appId, this.appPassword);
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  /**
   * 创建入站适配器（Bot Framework Webhook）
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
          self.logger.warn('MS Teams Webhook 服务器已在运行');
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

          req.on('end', async () => {
            try {
              const activity = JSON.parse(body) as Record<string, unknown>;
              const authHeader = req.headers['authorization'] as
                | string
                | undefined;

              // 验证 Bot Framework JWT
              if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                const result = await verifyBotFrameworkJwt(token);
                if (!result.verified) {
                  res.writeHead(401);
                  res.end('Unauthorized');
                  return;
                }
              }

              // 返回 200 OK 给 Bot Framework
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({}));

              // 处理消息活动
              if (activity['type'] === 'message') {
                self.handleTeamsActivity(activity);
              }
            } catch (parseErr) {
              handleError(parseErr, {
                module: 'channels:msteams',
                action: 'webhook:parseActivity',
              });
              res.writeHead(400);
              res.end('Bad Request');
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          self.webhookServer!.listen(self.webhookPort, () => {
            self.logger.info(
              `MS Teams Webhook 已启动 (端口: ${self.webhookPort})`
            );
            self.setInboundListening(true);
            resolve();
          });
          self.webhookServer!.on('error', (err: Error) => {
            handleError(err, {
              module: 'channels:msteams',
              action: 'webhook:serverError',
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
        self.logger.info('MS Teams Webhook 已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  /**
   * 处理入站 Teams Activity
   */
  private handleTeamsActivity(activity: Record<string, unknown>): void {
    const conversation = activity['conversation'] as
      | Record<string, unknown>
      | undefined;
    const from = activity['from'] as Record<string, unknown> | undefined;
    const conversationId = (conversation?.['id'] as string) || '';
    const activityId = (activity['id'] as string) || '';

    // 去重
    if (!this.dedup.claim(`${activityId}:${conversationId}`)) return;

    // 存储 ConversationReference 用于后续主动消息
    const ref: Record<string, unknown> = {
      activityId,
      user: activity['from'],
      bot: { id: this.appId, name: 'Liri Bot' },
      conversation,
      channelId: 'msteams',
      serviceUrl: (activity['serviceUrl'] as string) || this.serviceUrl,
      channelData: activity['channelData'],
    };
    this.convStore.set(conversationId, ref);
    this.serviceUrl = (activity['serviceUrl'] as string) || this.serviceUrl;

    const text = ((activity['text'] as string) || '')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) return;

    const senderName = (from?.['name'] as string) || 'Unknown';
    const senderId =
      (from?.['aadObjectId'] as string) ||
      (from?.['id'] as string) ||
      'unknown';

    const ctx: MessageContext = {
      channelId: 'msteams',
      senderId,
      senderName,
      groupId: conversationId,
      conversationId,
      messageId: activityId || randomUUID(),
      messageType: 'text' as const,
      content: text,
      timestamp: new Date(
        (activity['timestamp'] as string) || Date.now()
      ).getTime(),
      isDirectMessage: conversation?.['conversationType'] === 'personal',
      rawPayload: activity,
    };

    this.handleIncomingMessage(ctx).catch((err) => {
      handleError(err, {
        module: 'channels:msteams',
        action: 'handleIncomingMessage',
      });
    });
  }
}

export function createMSTeamsChannel(): IChannelPlugin {
  return new MSTeamsChannelPlugin();
}

export const msTeamsChannelPlugin = createMSTeamsChannel();
