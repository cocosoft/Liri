/**
 * 微信公众号通道插件
 * 厂商: 腾讯, 协议: 微信公众号消息推送 XML 格式
 * 特色: 被动回复(5s内) + 客服消息主动推送(48h内有过交互)
 */

import http from 'node:http';
import { createHash } from 'node:crypto';
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

const WECHAT_META: ChannelMeta = {
  id: 'wechat',
  displayName: '微信公众号',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://mp.weixin.qq.com/',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image'],
};

const WECHAT_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: false,
  imageMessage: true,
  webhook: true,
};

export const WECHAT_DEFAULT_CONFIG = {
  appId: '',
  appSecret: '',
  token: '',
  encodingAESKey: '',
  webhookPort: 8085,
};

/**
 * 微信公众号加解密工具
 */
class WechatCrypto {
  private aesKey: Buffer;

  constructor(encodingAESKey: string) {
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  }

  verifySignature(
    token: string,
    timestamp: string,
    nonce: string,
    signature: string
  ): boolean {
    const tmp = [token, timestamp, nonce].sort().join('');
    const hash = createHash('sha1').update(tmp).digest('hex');
    return hash === signature;
  }

  decryptMsg(encrypted: string): string {
    try {
      const crypto = require('node:crypto');
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        this.aesKey,
        this.aesKey.subarray(0, 16)
      );
      decipher.setAutoPadding(false);
      let decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]);
      const pad = decrypted[decrypted.length - 1];
      decrypted = decrypted.subarray(0, decrypted.length - pad);
      return decrypted.subarray(20).toString('utf-8');
    } catch {
      return encrypted;
    }
  }

  encryptMsg(msg: string, appId: string): string {
    const crypto = require('node:crypto');
    const randomBytes = crypto.randomBytes(16);
    const msgBuffer = Buffer.from(msg, 'utf-8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeInt32BE(msgBuffer.length, 0);
    const toEncrypt = Buffer.concat([
      randomBytes,
      lengthBuffer,
      msgBuffer,
      Buffer.from(appId, 'utf-8'),
    ]);
    const blockSize = 32;
    const padLen = blockSize - (toEncrypt.length % blockSize);
    const padBuffer = Buffer.alloc(padLen, padLen);
    const padded = Buffer.concat([toEncrypt, padBuffer]);

    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      this.aesKey,
      this.aesKey.subarray(0, 16)
    );
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
      'base64'
    );
  }
}

function parseWechatXML(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }
  const simplePattern = /<(\w+)>(.*?)<\/\1>/g;
  while ((match = simplePattern.exec(xml)) !== null) {
    if (!(match[1] in result)) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function buildWechatReply(
  toUser: string,
  fromUser: string,
  content: string,
  msgType = 'text'
): string {
  const time = Math.floor(Date.now() / 1000);
  return [
    '<xml>',
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>`,
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>`,
    `<CreateTime>${time}</CreateTime>`,
    `<MsgType><![CDATA[${msgType}]]></MsgType>`,
    `<Content><![CDATA[${content}]]></Content>`,
    '</xml>',
  ].join('');
}

class WechatChannelPlugin extends BaseChannelPlugin {
  readonly id = 'wechat';
  readonly meta = WECHAT_META;
  readonly capabilities = WECHAT_CAPABILITIES;
  private appId = '';
  private appSecret = '';
  private token = '';
  private encodingAESKey = '';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private cryptoInstance: WechatCrypto | null = null;
  private webhookServer: http.Server | null = null;
  private webhookPort = 8085;

  /** Token 后台刷新定时器（提前 5 分钟刷新，7200s 有效期） */
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'allowlist' as const,
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const userId =
          (sender['FromUserName'] as string) ||
          (sender['userId'] as string) ||
          'unknown';
        return { userId, displayName: userId, isApproved: false };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`微信公众号配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) =>
        code.length === 6,
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { ...WECHAT_DEFAULT_CONFIG };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId (微信公众号 AppID)');
    if (!config['appSecret']) errors.push('缺少 appSecret');
    if (!config['token']) errors.push('缺少 token (消息校验令牌)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appId =
      (config['appId'] as string) ||
      (process.env['WECHAT_APP_ID'] as string) ||
      '';
    this.appSecret =
      (config['appSecret'] as string) ||
      (process.env['WECHAT_APP_SECRET'] as string) ||
      '';
    this.token =
      (config['token'] as string) ||
      (process.env['WECHAT_TOKEN'] as string) ||
      '';
    this.encodingAESKey =
      (config['encodingAESKey'] as string) ||
      (process.env['WECHAT_ENCODING_AES_KEY'] as string) ||
      '';
    this.webhookPort =
      (config['webhookPort'] as number) ||
      parseInt(process.env['WECHAT_WEBHOOK_PORT'] as string, 10) ||
      8085;
    if (this.encodingAESKey) {
      this.cryptoInstance = new WechatCrypto(this.encodingAESKey);
    }

    if (!this.appId || !this.appSecret)
      throw new AppError(
        'Wechat: appId 和 appSecret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'wechat', missing: ['appId', 'appSecret'] }
      );

    await this.refreshAccessToken();
    this.startTokenBackgroundRefresh();
    this.logger.info('微信公众号通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.stopTokenBackgroundRefresh();
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * 从微信开放平台换取 Access Token
   */
  private async refreshAccessToken(): Promise<void> {
    const resp = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`
    );
    const data = (await resp.json()) as Record<string, unknown>;
    if (data['errcode']) {
      throw new AppError(
        `Wechat: ${data['errmsg'] || '获取 access_token 失败'}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        {
          channel: 'wechat',
          errcode: data['errcode'],
          errmsg: data['errmsg'],
        }
      );
    }
    this.accessToken = data['access_token'] as string;
    // expires_in 默认 7200 秒，提前 300 秒刷新
    const expiresIn = (data['expires_in'] as number) || 7200;
    this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000;
    this.logger.info('微信公众号 Access Token 已获取', {
      expiresAt: new Date(this.tokenExpiresAt).toISOString(),
    });
  }

  /**
   * 获取有效的 Access Token（含缓存和自动刷新）
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    await this.refreshAccessToken();
    return this.accessToken!;
  }

  /**
   * 启动 Token 后台定时刷新
   * 每 60 秒检查一次，若不足 5 分钟过期则提前刷新
   */
  private startTokenBackgroundRefresh(): void {
    this.stopTokenBackgroundRefresh();

    this.tokenRefreshTimer = setInterval(async () => {
      if (!this.accessToken || Date.now() + 300_000 >= this.tokenExpiresAt) {
        try {
          await this.refreshAccessToken();
          this.logger.info('微信公众号 Token 已后台刷新');
        } catch (e) {
          this.logger.error('微信公众号 Token 后台刷新失败', {
            error: String(e),
          });
        }
      }
    }, 60000);
  }

  /**
   * 停止 Token 后台刷新
   */
  private stopTokenBackgroundRefresh(): void {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    try {
      const token = await this.getAccessToken();
      const start = Date.now();
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/getcallbackip?access_token=${token}`
      );
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: 0 };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      const token = await this.getAccessToken();
      const body = {
        touser: target,
        msgtype: 'text',
        text: { content: content.slice(0, 2048) },
      };
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = (data['errcode'] as number) === 0;
      return {
        success: ok,
        error: ok ? undefined : (data['errmsg'] as string),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, content);
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    try {
      const token = await this.getAccessToken();
      const body = {
        touser: target,
        msgtype: 'image',
        image: { media_id: imageUrl },
      };
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: (data['errcode'] as number) === 0,
        error: data['errmsg'] as string,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async uploadWechatMedia(
    filePathOrUrl: string,
    mediaType: 'image' | 'voice' | 'video' | 'thumb'
  ): Promise<{ mediaId?: string; error?: string }> {
    try {
      const token = await this.getAccessToken();
      let blob: Blob;
      if (
        filePathOrUrl.startsWith('http://') ||
        filePathOrUrl.startsWith('https://')
      ) {
        const resp = await fetch(filePathOrUrl);
        if (!resp.ok) return { error: `下载文件失败: ${resp.status}` };
        blob = await resp.blob();
      } else {
        const fs = await import('node:fs');
        const buf = fs.readFileSync(filePathOrUrl);
        blob = new Blob([buf]);
      }
      const formData = new FormData();
      formData.append('media', blob, 'file');

      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${mediaType}`,
        { method: 'POST', body: formData }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      if ((data['errcode'] as number) !== 0) {
        return { error: (data['errmsg'] as string) || '上传素材失败' };
      }
      return { mediaId: data['media_id'] as string };
    } catch (e) {
      return { error: String(e) };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    // 微信客服消息不支持 file 类型，将文件作为 image 上传发送
    const upload = await this.uploadWechatMedia(filePath, 'image');
    if (!upload.mediaId) {
      return { success: false, error: upload.error || '上传文件失败' };
    }
    try {
      const token = await this.getAccessToken();
      const body = {
        touser: target,
        msgtype: 'image',
        image: { media_id: upload.mediaId },
      };
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: (data['errcode'] as number) === 0,
        error: data['errmsg'] as string,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    try {
      const token = await this.getAccessToken();
      const articles = [
        {
          title: card.title,
          description: card.content.slice(0, 512),
          url: 'https://github.com/pyapp',
          picurl: '',
        },
      ];
      const body = {
        touser: target,
        msgtype: 'news',
        news: { articles },
      };
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: (data['errcode'] as number) === 0,
        error: data['errmsg'] as string,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 创建入站适配器（Webhook 协议）
   * 启动 HTTP Server 接收微信公众号回调消息（XML 格式）
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
          self.logger.warn('微信 Webhook 服务器已在运行');
          return;
        }

        self.webhookServer = http.createServer((req, res) => {
          const parsedUrl = new URL(
            req.url || '/',
            `http://${req.headers.host || 'localhost'}`
          );
          const querySignature = parsedUrl.searchParams.get('signature') || '';
          const queryTimestamp = parsedUrl.searchParams.get('timestamp') || '';
          const queryNonce = parsedUrl.searchParams.get('nonce') || '';

          if (req.method === 'GET') {
            /* 微信 URL 验证：返回 echostr */
            const echostr = parsedUrl.searchParams.get('echostr') || '';
            if (
              echostr &&
              self.cryptoInstance?.verifySignature(
                self.token,
                queryTimestamp,
                queryNonce,
                querySignature
              )
            ) {
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end(echostr);
            } else {
              res.writeHead(403);
              res.end();
            }
            return;
          }

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
            /* 验证签名 */
            if (
              !self.cryptoInstance?.verifySignature(
                self.token,
                queryTimestamp,
                queryNonce,
                querySignature
              )
            ) {
              self.logger.warn('微信 Webhook 签名验证失败');
              res.writeHead(403);
              res.end();
              return;
            }

            try {
              /* 解析 XML，处理加密消息 */
              let rawXml = body;
              const parsedMsg = parseWechatXML(rawXml);
              const encrypt = parsedMsg['Encrypt'];

              if (encrypt && self.cryptoInstance) {
                rawXml = self.cryptoInstance.decryptMsg(encrypt);
              }

              const msg = rawXml !== body ? parseWechatXML(rawXml) : parsedMsg;
              const msgType = msg['MsgType'];

              if (msgType !== 'text') {
                res.writeHead(200);
                res.end('');
                return;
              }

              const ctx: MessageContext = {
                channelId: 'wechat',
                senderId: msg['FromUserName'] || '',
                senderName: msg['FromUserName'] || '',
                groupId: msg['FromUserName']?.startsWith('gh_')
                  ? undefined
                  : undefined,
                conversationId: msg['FromUserName'] || '',
                messageId: msg['MsgId'] || String(Date.now()),
                messageType: 'text',
                content: msg['Content'] || '',
                timestamp: Number(msg['CreateTime']) * 1000 || Date.now(),
                isDirectMessage: true,
                rawPayload: msg,
              };

              /* 返回空 XML 表示成功接收 */
              res.writeHead(200, { 'Content-Type': 'text/xml' });
              res.end('');

              self.handleIncomingMessage(ctx).catch((err) => {
                self.logger.error('微信消息处理异常', { error: String(err) });
              });
            } catch {
              self.logger.warn('微信 Webhook 消息解析失败');
              res.writeHead(400);
              res.end();
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          self.webhookServer!.listen(self.webhookPort, () => {
            self.logger.info(
              `微信 Webhook 服务器已启动 (端口: ${self.webhookPort})`
            );
            self.setInboundListening(true);
            resolve();
          });
          self.webhookServer!.on('error', (err: Error) => {
            self.logger.error('微信 Webhook 服务器启动失败', {
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
        self.logger.info('微信 Webhook 服务器已停止');
      },

      setMessageHandler: (
        handler: (
          message: import('@modules/channels/types').MessageContext
        ) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }
}

export function createWechatChannel(): IChannelPlugin {
  return new WechatChannelPlugin();
}

export const wechatChannel = createWechatChannel();
export const wechatChannelPlugin = createWechatChannel();
export { parseWechatXML, buildWechatReply, WechatCrypto };
