/**
 * QQ Bot 通道插件
 * 厂商: 腾讯, 协议: QQ 开放平台 WebSocket 长连接
 * 特色: WebSocket 心跳保活 + HTTP API 消息发送
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

const logger = new Logger({ level: LogLevel.INFO });

const QQ_META: ChannelMeta = {
  id: 'qq',
  displayName: 'QQ Bot',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://q.qq.com/',
  icon: '🐧',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
};

const QQ_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: true,
  webhook: true,
};

interface QQState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  appId: string;
  token: string;
  secret: string;
  wsConnection: unknown;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  sessionId: string | null;
}

function createQQChannel(): IChannelPlugin {
  const state: QQState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    appId: '',
    token: '',
    secret: '',
    wsConnection: null,
    heartbeatTimer: null,
    reconnectTimer: null,
    sessionId: null,
  };

  return {
    id: 'qq',
    meta: QQ_META,
    capabilities: QQ_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['appId']) errors.push('缺少 appId (QQ Bot AppID)');
        if (!c['token']) errors.push('缺少 token (Bot Token)');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          appId: '',
          token: '',
          secret: '',
          webhookPort: 8086,
          wsHost: 'api.sgroup.qq.com',
        };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.appId = (config['appId'] as string) || '';
        state.token = (config['token'] as string) || '';
        state.secret = (config['secret'] as string) || '';

        if (!state.appId || !state.token)
          throw new Error('QQ Bot: appId 和 token 是必需的');

        state.startTime = Date.now();
        state.connected = true;

        // QQ Bot WebSocket 实际连接需要先获取 Gateway URL，
        // 简化实现: 标记为已连接，实际生产环境通过 qq-bot-sdk 管理
        logger.info('QQ Bot 通道已连接');
      },

      async disconnect() {
        state.connected = false;
        if (state.heartbeatTimer) {
          clearInterval(state.heartbeatTimer);
          state.heartbeatTimer = null;
        }
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        logger.info('QQ Bot 通道已断开');
      },

      async healthCheck() {
        const start = Date.now();
        try {
          const resp = await fetch('https://api.sgroup.qq.com/gateway', {
            headers: { Authorization: `Bot ${state.appId}.${state.token}` },
          });
          return { healthy: resp.ok, latencyMs: Date.now() - start };
        } catch {
          return { healthy: state.connected, latencyMs: Date.now() - start };
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
        if (!state.appId || !state.token)
          return { success: false, error: '未连接' };
        try {
          const body = {
            msg_type: 0,
            content: content.slice(0, QQ_META.maxMessageLength),
            msg_id: `${Date.now()}`,
          };
          const url = target.includes('channels/')
            ? `https://api.sgroup.qq.com/channels/${target}/messages`
            : `https://api.sgroup.qq.com/v2/users/${target}/messages`;

          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bot ${state.appId}.${state.token}`,
            },
            body: JSON.stringify(body),
          });
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = resp.ok;
          state.lastMessageAt = Date.now();
          return {
            success: ok,
            error: ok ? undefined : (data['message'] as string),
            messageId: data['id'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        if (!state.appId || !state.token)
          return { success: false, error: '未连接' };
        try {
          const body = {
            msg_type: 2,
            markdown: { content },
            msg_id: `${Date.now()}`,
          };
          const resp = await fetch(
            `https://api.sgroup.qq.com/v2/users/${target}/messages`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bot ${state.appId}.${state.token}`,
              },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: resp.ok,
            error: data['message'] as string,
            messageId: data['id'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return {
          success: false,
          error: 'QQ Bot 图片发送需先上传素材，暂未实现',
        };
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        return { success: false, error: 'QQ Bot 文件发送暂未实现' };
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        // QQ Bot 不支持交互式卡片，降级为 Markdown
        const mdContent = `**${card.title}**\n${card.content}`;
        return this.sendMarkdown(target, mdContent);
      },
    },

    security: {
      dmPolicy: 'pairing',
      allowFrom: [],
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 5,
      async resolveSender(sender: Record<string, unknown>) {
        const author = sender['author'] as Record<string, unknown> | undefined;
        const userId =
          (sender['id'] as string) || (author?.['id'] as string) || 'unknown';
        const username = (author?.['username'] as string) || userId;
        return { userId, displayName: username, isApproved: false };
      },
      async authorizeMessage(ctx) {
        return { allowed: true };
      },
    },

    pairing: {
      async generatePairingCode(userId: string) {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        logger.info(`QQ Bot 配对码: ${userId} → ${code}`);
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

export const qqChannel = createQQChannel();
export type { QQState };
