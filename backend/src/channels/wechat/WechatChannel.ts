/**
 * 微信公众号通道插件
 * 厂商: 腾讯, 协议: 微信公众号消息推送 XML 格式
 * 特色: 被动回复(5s内) + 客服消息主动推送(48h内有过交互)
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { createHash } from 'node:crypto';

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
    this.appId = (config['appId'] as string) || '';
    this.appSecret = (config['appSecret'] as string) || '';
    this.token = (config['token'] as string) || '';
    this.encodingAESKey = (config['encodingAESKey'] as string) || '';

    if (!this.appId || !this.appSecret)
      throw new AppError(
        'Wechat: appId 和 appSecret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'wechat', missing: ['appId', 'appSecret'] }
      );

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
    this.tokenExpiresAt =
      Date.now() + ((data['expires_in'] as number) || 7200) * 1000;
    this.logger.info('微信公众号通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.accessToken = null;
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    if (!this.accessToken) return { healthy: false, latencyMs: 0 };
    const start = Date.now();
    try {
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/getcallbackip?access_token=${this.accessToken}`
      );
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.accessToken) return { success: false, error: '未连接' };
    try {
      const body = {
        touser: target,
        msgtype: 'text',
        text: { content: content.slice(0, 2048) },
      };
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.accessToken}`,
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
    if (!this.accessToken) return { success: false, error: '未连接' };
    try {
      const body = {
        touser: target,
        msgtype: 'image',
        image: { media_id: imageUrl },
      };
      const resp = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.accessToken}`,
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

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return { success: false, error: '微信公众号文件发送暂未实现' };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    if (!this.accessToken) return { success: false, error: '未连接' };
    try {
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
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.accessToken}`,
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
}

function createWechatChannel(): IChannelPlugin {
  return new WechatChannelPlugin();
}

export const wechatChannel = createWechatChannel();
export { parseWechatXML, buildWechatReply, WechatCrypto };
