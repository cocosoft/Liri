/**
 * 飞书通道插件
 * 厂商: 字节跳动, SDK: @larksuiteoapi/node-sdk
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

const FEISHU_META: ChannelMeta = {
  id: 'feishu',
  displayName: '飞书',
  vendor: '字节跳动 (ByteDance)',
  vendorSite: 'https://open.feishu.cn/',
  icon: '🐦',
  markdownCapable: false,
  maxMessageLength: 30000,
  supportedMessageTypes: ['text', 'image', 'file', 'card'],
};

const FEISHU_CAPABILITIES: ChannelCapabilities = {
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

interface FeishuState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  appId: string;
  appSecret: string;
  tenantAccessToken: string | null;
  tokenExpiresAt: number;
}

function createFeishuChannel(): IChannelPlugin {
  const state: FeishuState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    appId: '',
    appSecret: '',
    tenantAccessToken: null,
    tokenExpiresAt: 0,
  };

  return {
    id: 'feishu',
    meta: FEISHU_META,
    capabilities: FEISHU_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['appId']) errors.push('缺少 appId');
        if (!c['appSecret']) errors.push('缺少 appSecret');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { appId: '', appSecret: '', verifyToken: '', webhookPort: 8083 };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.appId = (config['appId'] as string) || '';
        state.appSecret = (config['appSecret'] as string) || '';
        if (!state.appId || !state.appSecret)
          throw new Error('Feishu: appId 和 appSecret 是必需的');

        state.startTime = Date.now();
        try {
          const resp = await fetch(
            'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                app_id: state.appId,
                app_secret: state.appSecret,
              }),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          if ((data['code'] as number) !== 0) {
            throw new Error(
              `Feishu: ${data['msg'] || '获取 tenant_access_token 失败'}`
            );
          }
          state.tenantAccessToken = data['tenant_access_token'] as string;
          state.tokenExpiresAt =
            Date.now() + ((data['expire'] as number) || 7200) * 1000;
          state.connected = true;
          logger.info('飞书通道已连接');
        } catch (err) {
          logger.error('飞书连接失败', err as Error);
          throw err;
        }
      },

      async disconnect() {
        state.connected = false;
        state.tenantAccessToken = null;
        logger.info('飞书通道已断开');
      },

      async healthCheck() {
        const start = Date.now();
        if (!state.tenantAccessToken) return { healthy: false, latencyMs: 0 };
        try {
          const resp = await fetch(
            'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                app_id: state.appId,
                app_secret: state.appSecret,
              }),
            }
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
        if (!state.tenantAccessToken)
          return { success: false, error: '未连接' };
        try {
          const body = {
            receive_id: target,
            msg_type: 'text',
            content: JSON.stringify({ text: content }),
          };
          const resp = await fetch(
            'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${state.tenantAccessToken}`,
              },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = (data['code'] as number) === 0;
          state.lastMessageAt = Date.now();
          return {
            success: ok,
            error: ok ? undefined : (data['msg'] as string),
            messageId: data['data']
              ? ((data['data'] as Record<string, unknown>)[
                  'message_id'
                ] as string)
              : undefined,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        return this.sendText(target, content);
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return { success: false, error: '飞书图片发送需先上传素材，暂未实现' };
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        return { success: false, error: '飞书文件发送需先上传素材，暂未实现' };
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        if (!state.tenantAccessToken)
          return { success: false, error: '未连接' };
        try {
          const feishuCard = {
            header: { title: { tag: 'plain_text', content: card.title } },
            elements: [
              {
                tag: 'div',
                text: { tag: 'plain_text', content: card.content },
              },
            ],
          };
          if (card.buttons) {
            const actions = card.buttons.map(
              (b: { text: string; value: string; style?: string }) => ({
                tag: 'button',
                text: { tag: 'plain_text', content: b.text },
                value: { key: 'action', value: b.value },
                type: b.style === 'danger' ? 'danger' : 'primary',
              })
            );
            (feishuCard.elements as unknown[]).push({ tag: 'action', actions });
          }
          const body = {
            receive_id: target,
            msg_type: 'interactive',
            content: JSON.stringify(feishuCard),
          };
          const resp = await fetch(
            'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${state.tenantAccessToken}`,
              },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: (data['code'] as number) === 0,
            error: data['msg'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    security: {
      dmPolicy: 'pairing',
      allowFrom: [],
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 5,
      async resolveSender(sender: Record<string, unknown>) {
        const userId =
          (sender['open_id'] as string) ||
          (sender['sender_id'] as string) ||
          'unknown';
        return {
          userId,
          displayName: (sender['sender_name'] as string) || userId,
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
        logger.info(`飞书配对码: ${userId} → ${code}`);
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

export const feishuChannel = createFeishuChannel();
