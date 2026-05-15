/**
 * 钉钉通道插件
 * 厂商: 阿里巴巴, SDK: dingtalk-robot-sender
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

const DINGTALK_META: ChannelMeta = {
  id: 'dingtalk',
  displayName: '钉钉',
  vendor: '阿里巴巴 (Alibaba)',
  vendorSite: 'https://open.dingtalk.com/',
  icon: '📌',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'markdown', 'card'],
};

const DINGTALK_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: true,
};

interface DingtalkState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  appKey: string;
  appSecret: string;
  accessToken: string | null;
  tokenExpiresAt: number;
}

async function sendViaWebhook(
  target: string,
  payload: Record<string, unknown>
): Promise<SendResult> {
  const webhookUrl = target;
  if (!webhookUrl.startsWith('https://oapi.dingtalk.com/robot/send')) {
    return { success: false, error: '钉钉 Webhook URL 格式不正确' };
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return {
    success: (data['errcode'] as number) === 0,
    error: data['errmsg'] as string,
  };
}

function createDingtalkChannel(): IChannelPlugin {
  const state: DingtalkState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    appKey: '',
    appSecret: '',
    accessToken: null,
    tokenExpiresAt: 0,
  };

  return {
    id: 'dingtalk',
    meta: DINGTALK_META,
    capabilities: DINGTALK_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['appKey']) errors.push('缺少 appKey');
        if (!c['appSecret']) errors.push('缺少 appSecret');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { appKey: '', appSecret: '', webhookUrl: '', webhookPort: 8084 };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.appKey = (config['appKey'] as string) || '';
        state.appSecret = (config['appSecret'] as string) || '';
        if (!state.appKey || !state.appSecret)
          throw new AppError(
            'DingTalk: appKey 和 appSecret 是必需的',
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'INVALID_INPUT',
            { channel: 'dingtalk', missing: ['appKey', 'appSecret'] }
          );

        state.startTime = Date.now();

        try {
          const url = `https://oapi.dingtalk.com/gettoken?appkey=${state.appKey}&appsecret=${state.appSecret}`;
          const response = await fetch(url);
          const data = (await response.json()) as Record<string, unknown>;
          if ((data['errcode'] as number) !== 0) {
            throw new AppError(
              `DingTalk: ${data['errmsg'] || '获取 access_token 失败'}`,
              ErrorCategory.API,
              ErrorSeverity.HIGH,
              'API_ERROR',
              { channel: 'dingtalk', errcode: data['errcode'], errmsg: data['errmsg'] }
            );
          }
          state.accessToken = data['access_token'] as string;
          state.tokenExpiresAt = Date.now() + 7000 * 1000;
          state.connected = true;
          logger.info('钉钉通道已连接');
        } catch (err) {
          logger.error('钉钉连接失败', err as Error);
          throw err;
        }
      },

      async disconnect() {
        state.connected = false;
        state.accessToken = null;
        logger.info('钉钉通道已断开');
      },

      async healthCheck() {
        const start = Date.now();
        if (!state.accessToken) return { healthy: false, latencyMs: 0 };
        try {
          const resp = await fetch(
            `https://oapi.dingtalk.com/gettoken?appkey=${state.appKey}&appsecret=${state.appSecret}`
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
        if (!state.accessToken) {
          return sendViaWebhook(target, { msgtype: 'text', text: { content } });
        }
        try {
          const resp = await fetch(
            `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${state.accessToken}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent_id: state.appKey,
                userid_list: target,
                msg: { msgtype: 'text', text: { content } },
              }),
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
        try {
          return sendViaWebhook(target, {
            msgtype: 'markdown',
            markdown: { title: 'PY_APP', text: content },
          });
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return { success: false, error: '钉钉图片发送暂未实现' };
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        return { success: false, error: '钉钉文件发送暂未实现' };
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        try {
          return sendViaWebhook(target, {
            msgtype: 'actionCard',
            actionCard: {
              title: card.title,
              text: card.content,
              btns: card.buttons?.map(
                (b: { text: string; value: string; style?: string }) => ({
                  title: b.text,
                  actionURL: `pyapp://action?value=${b.value}`,
                })
              ),
            },
          });
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
          (sender['senderId'] as string) ||
          (sender['userId'] as string) ||
          'unknown';
        return {
          userId,
          displayName: (sender['senderNick'] as string) || userId,
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
        logger.info(`钉钉配对码: ${userId} → ${code}`);
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

export const dingtalkChannel = createDingtalkChannel();
