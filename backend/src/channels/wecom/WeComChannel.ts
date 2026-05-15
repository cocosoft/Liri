/**
 * 企业微信通道插件
 * 厂商: 腾讯, SDK: @wecom/crypto + 企业微信服务端 API
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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const WECOM_META: ChannelMeta = {
  id: 'wecom',
  displayName: '企业微信',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://work.weixin.qq.com/',
  icon: '💼',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown', 'card'],
};

const WECOM_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

const WECOM_DEFAULT_CONFIG = {
  corpId: '',
  agentId: '',
  secret: '',
  token: '',
  encodingAESKey: '',
  webhookPort: 8082,
};

interface WeComState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  accessToken: string | null;
  tokenExpiresAt: number;
}

function createWeComChannel(): IChannelPlugin {
  const state: WeComState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    accessToken: null,
    tokenExpiresAt: 0,
  };

  return {
    id: 'wecom',
    meta: WECOM_META,
    capabilities: WECOM_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['corpId']) errors.push('缺少 corpId');
        if (!c['secret']) errors.push('缺少 secret');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { ...WECOM_DEFAULT_CONFIG };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        const corpId = config['corpId'] as string;
        const secret = config['secret'] as string;
        if (!corpId || !secret)
          throw new AppError(
            'WeCom: corpId 和 secret 是必需的',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT',
            { channel: 'wecom', missing: ['corpId', 'secret'] }
          );

        state.startTime = Date.now();

        try {
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`
          );
          const data = (await resp.json()) as Record<string, unknown>;
          if ((data['errcode'] as number) !== 0) {
            throw new AppError(
              `WeCom: ${data['errmsg'] || '获取 access_token 失败'}`,
              ErrorCategory.API,
              ErrorSeverity.HIGH,
              'API_ERROR',
              { channel: 'wecom', errcode: data['errcode'], errmsg: data['errmsg'] }
            );
          }
          state.accessToken = data['access_token'] as string;
          state.tokenExpiresAt =
            Date.now() + ((data['expires_in'] as number) || 7200) * 1000;
          state.connected = true;
          logger.info('企业微信通道已连接');
        } catch (err) {
          logger.error('企业微信连接失败', err as Error);
          throw err;
        }
      },

      async disconnect() {
        state.connected = false;
        state.accessToken = null;
        logger.info('企业微信通道已断开');
      },

      async healthCheck() {
        const start = Date.now();
        if (!state.accessToken) return { healthy: false, latencyMs: 0 };
        try {
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/getcallbackip?access_token=${state.accessToken}`
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
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${state.accessToken}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                touser: target,
                msgtype: 'text',
                agentid: WECOM_DEFAULT_CONFIG.agentId || 1,
                text: { content },
              }),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = (data['errcode'] as number) === 0;
          const start = Date.now();
          state.lastMessageAt = start;
          return {
            success: ok,
            error: ok ? undefined : (data['errmsg'] as string),
            messageId: data['msgid'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        if (!state.accessToken) return { success: false, error: '未连接' };
        try {
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${state.accessToken}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                touser: target,
                msgtype: 'markdown',
                agentid: WECOM_DEFAULT_CONFIG.agentId || 1,
                markdown: { content },
              }),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: (data['errcode'] as number) === 0,
            error: data['errmsg'] as string,
            messageId: data['msgid'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return {
          success: false,
          error: '企业微信图片发送需先上传素材，暂未实现',
        };
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        return {
          success: false,
          error: '企业微信文件发送需先上传素材，暂未实现',
        };
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        if (!state.accessToken) return { success: false, error: '未连接' };
        try {
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${state.accessToken}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                touser: target,
                msgtype: 'textcard',
                agentid: WECOM_DEFAULT_CONFIG.agentId || 1,
                textcard: {
                  title: card.title,
                  description: card.content,
                  url: 'https://github.com/pyapp',
                },
              }),
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
          (sender['UserID'] as string) ||
          (sender['userId'] as string) ||
          'unknown';
        return {
          userId,
          displayName: (sender['Name'] as string) || userId,
          isApproved: false,
        };
      },
      async authorizeMessage(ctx: {
        channelId: string;
        senderId: string;
        messageId: string;
        content: string;
        timestamp: number;
        messageType: string;
        isDirectMessage: boolean;
        rawPayload: Record<string, unknown>;
      }) {
        return { allowed: true };
      },
    },

    pairing: {
      async generatePairingCode(userId: string) {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        logger.info(`企业微信配对码: ${userId} → ${code}`);
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

export const wecomChannel = createWeComChannel();
