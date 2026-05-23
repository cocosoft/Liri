/**
 * 企业微信通道插件
 * 厂商: 腾讯, 协议: 企业微信服务端 API
 * 特色: access_token 自动管理、消息推送(应用消息)、Markdown 支持
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
  icon: '🏢',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
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

interface WecomState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  corpId: string;
  corpSecret: string;
  agentId: string;
  token: string;
  encodingAESKey: string;
  accessToken: string | null;
  tokenExpiresAt: number;
}

function createWecomChannel(): IChannelPlugin {
  const state: WecomState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    corpId: '',
    corpSecret: '',
    agentId: '',
    token: '',
    encodingAESKey: '',
    accessToken: null,
    tokenExpiresAt: 0,
  };

  async function getAccessToken(): Promise<string | null> {
    if (state.accessToken && Date.now() < state.tokenExpiresAt) {
      return state.accessToken;
    }
    if (!state.corpId || !state.corpSecret) return null;

    try {
      const resp = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${state.corpId}&corpsecret=${state.corpSecret}`
      );
      const data = (await resp.json()) as Record<string, unknown>;
      if ((data['errcode'] as number) === 0) {
        state.accessToken = data['access_token'] as string;
        state.tokenExpiresAt =
          Date.now() + ((data['expires_in'] as number) || 7200) * 1000;
        return state.accessToken;
      }
      logger.error('企业微信获取 access_token 失败', {
        errcode: data['errcode'],
        errmsg: data['errmsg'],
      });
    } catch (err) {
      logger.error('企业微信获取 access_token 网络错误', err as Error);
    }
    return null;
  }

  return {
    id: 'wecom',
    meta: WECOM_META,
    capabilities: WECOM_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['corpId']) errors.push('缺少 corpId (企业 ID)');
        if (!c['corpSecret']) errors.push('缺少 corpSecret (企业密钥)');
        if (!c['agentId']) errors.push('缺少 agentId (应用 AgentId)');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          corpId: '',
          corpSecret: '',
          agentId: '',
          token: '',
          encodingAESKey: '',
        };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.corpId = (config['corpId'] as string) || '';
        state.corpSecret = (config['corpSecret'] as string) || '';
        state.agentId = (config['agentId'] as string) || '';
        state.token = (config['token'] as string) || '';
        state.encodingAESKey = (config['encodingAESKey'] as string) || '';

        if (!state.corpId || !state.corpSecret || !state.agentId) {
          throw new AppError(
            'Wecom: corpId, corpSecret 和 agentId 是必需的',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT',
            {
              channel: 'wecom',
              missing: [
                !state.corpId ? 'corpId' : null,
                !state.corpSecret ? 'corpSecret' : null,
                !state.agentId ? 'agentId' : null,
              ].filter(Boolean),
            }
          );
        }

        state.startTime = Date.now();

        const token = await getAccessToken();
        if (token) {
          state.connected = true;
          logger.info('企业微信通道已连接');
        } else {
          logger.warning('企业微信通道连接失败：无法获取 access_token');
          throw new AppError(
            '企业微信连接失败：无法获取 access_token，请检查 corpId 和 corpSecret',
            ErrorCategory.API,
            ErrorSeverity.HIGH,
            'AUTH_FAILED',
            { channel: 'wecom' }
          );
        }
      },

      async disconnect() {
        state.connected = false;
        state.accessToken = null;
        state.tokenExpiresAt = 0;
        logger.info('企业微信通道已断开');
      },

      async healthCheck() {
        if (!state.accessToken) return { healthy: false, latencyMs: 0 };
        const start = Date.now();
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
        const token = await getAccessToken();
        if (!token) return { success: false, error: '未连接或 token 失效' };

        try {
          const body = {
            touser: target || '@all',
            msgtype: 'text',
            agentid: parseInt(state.agentId, 10) || 1,
            text: { content: content.slice(0, 2048) },
          };
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = (data['errcode'] as number) === 0;
          if (ok) state.lastMessageAt = Date.now();
          return {
            success: ok,
            error: ok ? undefined : (data['errmsg'] as string),
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        const token = await getAccessToken();
        if (!token) return { success: false, error: '未连接或 token 失效' };

        try {
          const body = {
            touser: target || '@all',
            msgtype: 'markdown',
            agentid: parseInt(state.agentId, 10) || 1,
            markdown: { content: content.slice(0, 2048) },
          };
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = (data['errcode'] as number) === 0;
          if (ok) state.lastMessageAt = Date.now();
          return {
            success: ok,
            error: ok ? undefined : (data['errmsg'] as string),
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        const token = await getAccessToken();
        if (!token) return { success: false, error: '未连接或 token 失效' };

        try {
          const body = {
            touser: target || '@all',
            msgtype: 'image',
            agentid: parseInt(state.agentId, 10) || 1,
            image: { media_id: imageUrl },
          };
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
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
        return { success: false, error: '企业微信文件发送暂未实现' };
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        const token = await getAccessToken();
        if (!token) return { success: false, error: '未连接或 token 失效' };

        try {
          const articles = [
            {
              title: card.title,
              description: card.content.slice(0, 512),
              url: 'https://github.com/pyapp',
            },
          ];
          const body = {
            touser: target || '@all',
            msgtype: 'news',
            agentid: parseInt(state.agentId, 10) || 1,
            news: { articles },
          };
          const resp = await fetch(
            `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
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
          (sender['UserId'] as string) ||
          (sender['userId'] as string) ||
          (sender['OpenId'] as string) ||
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

export const wecomChannel = createWecomChannel();
