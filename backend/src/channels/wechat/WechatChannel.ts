/**
 * 微信公众号通道插件
 * 厂商: 腾讯, 协议: 微信公众号消息推送 XML 格式
 * 特色: 被动回复(5s内) + 客服消息主动推送(48h内有过交互)
 */

import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { createHash } from 'node:crypto';

const logger = new Logger({ level: LogLevel.INFO });

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

interface WechatState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey: string;
  accessToken: string | null;
  tokenExpiresAt: number;
}

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

  /**
   * 验证微信服务器签名
   */
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

  /**
   * 解密 XML 消息体
   */
  decryptMsg(encrypted: string): string {
    try {
      const decipher = require('node:crypto').createDecipheriv(
        'aes-256-cbc',
        this.aesKey,
        this.aesKey.subarray(0, 16)
      );
      decipher.setAutoPadding(false);
      let decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
      ]);
      // 去除 PKCS7 填充
      const pad = decrypted[decrypted.length - 1];
      decrypted = decrypted.subarray(0, decrypted.length - pad);
      // 跳过 16 字节随机串 + 4 字节网络序长度
      return decrypted.subarray(20).toString('utf-8');
    } catch {
      return encrypted;
    }
  }

  /**
   * 加密回复消息
   */
  encryptMsg(msg: string, appId: string): string {
    const randomBytes = require('node:crypto').randomBytes(16);
    const msgBuffer = Buffer.from(msg, 'utf-8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeInt32BE(msgBuffer.length, 0);
    const toEncrypt = Buffer.concat([
      randomBytes,
      lengthBuffer,
      msgBuffer,
      Buffer.from(appId, 'utf-8'),
    ]);
    // PKCS7 填充
    const blockSize = 32;
    const padLen = blockSize - (toEncrypt.length % blockSize);
    const padBuffer = Buffer.alloc(padLen, padLen);
    const padded = Buffer.concat([toEncrypt, padBuffer]);

    const cipher = require('node:crypto').createCipheriv(
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

/**
 * 简易 XML 消息解析器
 */
function parseWechatXML(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }
  // 非 CDATA 字段
  const simplePattern = /<(\w+)>(.*?)<\/\1>/g;
  while ((match = simplePattern.exec(xml)) !== null) {
    if (!(match[1] in result)) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

/**
 * 构建 XML 回复
 */
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

function createWechatChannel(): IChannelPlugin {
  const state: WechatState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    appId: '',
    appSecret: '',
    token: '',
    encodingAESKey: '',
    accessToken: null,
    tokenExpiresAt: 0,
  };

  const crypto = {
    instance: null as WechatCrypto | null,
    getInstance(aesKey: string): WechatCrypto {
      if (!this.instance || state.encodingAESKey !== aesKey) {
        this.instance = new WechatCrypto(aesKey);
      }
      return this.instance;
    },
  };

  return {
    id: 'wechat',
    meta: WECHAT_META,
    capabilities: WECHAT_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['appId']) errors.push('缺少 appId (微信公众号 AppID)');
        if (!c['appSecret']) errors.push('缺少 appSecret');
        if (!c['token']) errors.push('缺少 token (消息校验令牌)');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { ...WECHAT_DEFAULT_CONFIG };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.appId = (config['appId'] as string) || '';
        state.appSecret = (config['appSecret'] as string) || '';
        state.token = (config['token'] as string) || '';
        state.encodingAESKey = (config['encodingAESKey'] as string) || '';

        if (!state.appId || !state.appSecret)
          throw new Error('Wechat: appId 和 appSecret 是必需的');

        state.startTime = Date.now();

        try {
          const resp = await fetch(
            `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${state.appId}&secret=${state.appSecret}`
          );
          const data = (await resp.json()) as Record<string, unknown>;
          if (data['errcode']) {
            throw new Error(
              `Wechat: ${data['errmsg'] || '获取 access_token 失败'}`
            );
          }
          state.accessToken = data['access_token'] as string;
          state.tokenExpiresAt =
            Date.now() + ((data['expires_in'] as number) || 7200) * 1000;
          state.connected = true;
          logger.info('微信公众号通道已连接');
        } catch (err) {
          logger.error('微信公众号连接失败', err as Error);
          throw err;
        }
      },

      async disconnect() {
        state.connected = false;
        state.accessToken = null;
        logger.info('微信公众号通道已断开');
      },

      async healthCheck() {
        if (!state.accessToken) return { healthy: false, latencyMs: 0 };
        const start = Date.now();
        try {
          const resp = await fetch(
            `https://api.weixin.qq.com/cgi-bin/getcallbackip?access_token=${state.accessToken}`
          );
          return { healthy: resp.ok, latencyMs: Date.now() - start };
        } catch {
          return { healthy: false, latencyMs: Date.now() - start };
        }
      },

      getStatus(): ChannelStatus {
        return {
          connected: state.connected,
          latencyMs: 0,
          lastMessageAt: state.lastMessageAt,
          uptimeMs: state.connected ? Date.now() - state.startTime : 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        if (!state.accessToken) return { success: false, error: '未连接' };
        try {
          const body = {
            touser: target,
            msgtype: 'text',
            text: { content: content.slice(0, 2048) },
          };
          const resp = await fetch(
            `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${state.accessToken}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = (data['errcode'] as number) === 0;
          state.lastMessageAt = Date.now();
          return {
            success: ok,
            error: ok ? undefined : (data['errmsg'] as string),
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        if (!state.accessToken) return { success: false, error: '未连接' };
        try {
          const body = {
            touser: target,
            msgtype: 'image',
            image: { media_id: imageUrl },
          };
          const resp = await fetch(
            `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${state.accessToken}`,
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
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        return { success: false, error: '微信公众号文件发送暂未实现' };
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        if (!state.accessToken) return { success: false, error: '未连接' };
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
            `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${state.accessToken}`,
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
      },
    },

    security: {
      dmPolicy: 'allowlist',
      allowFrom: [],
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 5,
      async resolveSender(sender: Record<string, unknown>) {
        const userId =
          (sender['FromUserName'] as string) ||
          (sender['userId'] as string) ||
          'unknown';
        return { userId, displayName: userId, isApproved: false };
      },
      async authorizeMessage(ctx) {
        return { allowed: true };
      },
    },

    pairing: {
      async generatePairingCode(userId: string) {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        logger.info(`微信公众号配对码: ${userId} → ${code}`);
        return code;
      },
      async validatePairingCode(_userId: string, code: string) {
        return code.length === 6;
      },
      async listApprovedUsers() {
        return [];
      },
      async removeApprovedUser(_userId: string) {},
    },
  };
}

export const wechatChannel = createWechatChannel();
export { parseWechatXML, buildWechatReply, WechatCrypto };
