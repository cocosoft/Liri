/**
 * Telegram 通道插件
 * 厂商: Telegram, 协议: Bot API HTTP + Webhook
 * 特色: 原生 MarkdownV2 + Inline Keyboard + 文件发送
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

const TELEGRAM_META: ChannelMeta = {
  id: 'telegram',
  displayName: 'Telegram',
  vendor: 'Telegram Messenger',
  vendorSite: 'https://core.telegram.org/bots/api',
  icon: '✈️',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown', 'card'],
};

const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: true,
  reactions: false,
  interactive: true,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: true,
};

interface TelegramState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  botToken: string;
  webhookUrl: string;
}

/**
 * Telegram MarkdownV2 转义
 * 保护 MarkdownV2 特殊字符不被解析
 */
function escapeMarkdownV2(text: string): string {
  const specialChars = [
    '_',
    '*',
    '[',
    ']',
    '(',
    ')',
    '~',
    '`',
    '>',
    '#',
    '+',
    '-',
    '=',
    '|',
    '{',
    '}',
    '.',
    '!',
  ];
  let result = text;
  for (const char of specialChars) {
    result = result.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
  }
  return result;
}

/**
 * 将 InteractiveCard 转为 Telegram InlineKeyboard
 */
function buildInlineKeyboard(
  card: InteractiveCard
): Record<string, unknown> | undefined {
  if (!card.buttons || card.buttons.length === 0) return undefined;
  return {
    inline_keyboard: [
      card.buttons.map((b) => ({
        text: b.text,
        callback_data: b.value,
      })),
    ],
  };
}

function createTelegramChannel(): IChannelPlugin {
  const state: TelegramState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    botToken: '',
    webhookUrl: '',
  };

  return {
    id: 'telegram',
    meta: TELEGRAM_META,
    capabilities: TELEGRAM_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['botToken']) errors.push('缺少 botToken (Telegram Bot Token)');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { botToken: '', webhookPort: 8443, webhookUrl: '' };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.botToken = (config['botToken'] as string) || '';
        state.webhookUrl = (config['webhookUrl'] as string) || '';

        if (!state.botToken) throw new Error('Telegram: botToken 是必需的');

        state.startTime = Date.now();

        try {
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/getMe`
          );
          const data = (await resp.json()) as Record<string, unknown>;
          if (!data['ok']) {
            throw new Error(`Telegram: ${data['description'] || 'getMe 失败'}`);
          }

          // 如果配置了 webhook，注册之
          if (state.webhookUrl) {
            await fetch(
              `https://api.telegram.org/bot${state.botToken}/setWebhook?url=${encodeURIComponent(state.webhookUrl)}`
            );
          }

          state.connected = true;
          logger.info(
            `Telegram 通道已连接 (Bot: ${(data['result'] as Record<string, unknown>)?.['username'] || '?'})`
          );
        } catch (err) {
          logger.error('Telegram 连接失败', err as Error);
          throw err;
        }
      },

      async disconnect() {
        state.connected = false;
        // 不主动删除 webhook，避免影响其他实例
        logger.info('Telegram 通道已断开');
      },

      async healthCheck() {
        const start = Date.now();
        if (!state.botToken) return { healthy: false, latencyMs: 0 };
        try {
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/getMe`
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
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const body = {
            chat_id: target,
            text: content.slice(0, TELEGRAM_META.maxMessageLength),
            parse_mode: 'HTML',
          };
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          const ok = data['ok'] === true;
          state.lastMessageAt = Date.now();
          return {
            success: ok,
            error: ok ? undefined : (data['description'] as string),
            messageId: data['result']
              ? String(
                  (data['result'] as Record<string, unknown>)['message_id']
                )
              : undefined,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const escaped = escapeMarkdownV2(content);
          const body = {
            chat_id: target,
            text: escaped.slice(0, TELEGRAM_META.maxMessageLength),
            parse_mode: 'MarkdownV2',
          };
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: data['ok'] === true,
            error: data['description'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const body = { chat_id: target, photo: imageUrl };
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/sendPhoto`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: data['ok'] === true,
            error: data['description'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const file = require('node:fs').createReadStream(filePath);
          const formData = new FormData();
          formData.append('chat_id', target);
          formData.append('document', file as unknown as Blob);
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/sendDocument`,
            { method: 'POST', body: formData }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: data['ok'] === true,
            error: data['description'] as string,
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const keyboard = buildInlineKeyboard(card);
          const body: Record<string, unknown> = {
            chat_id: target,
            text: `*${escapeMarkdownV2(card.title)}*\n${escapeMarkdownV2(card.content)}`,
            parse_mode: 'MarkdownV2',
          };
          if (keyboard) {
            body['reply_markup'] = JSON.stringify(keyboard);
          }
          const resp = await fetch(
            `https://api.telegram.org/bot${state.botToken}/sendMessage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return {
            success: data['ok'] === true,
            error: data['description'] as string,
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
        const msg = sender['message'] as Record<string, unknown> | undefined;
        const fromMsg = msg
          ? (msg['from'] as Record<string, unknown> | undefined)
          : undefined;
        const fromDirect = sender['from'] as
          | Record<string, unknown>
          | undefined;
        const from: Record<string, unknown> = fromMsg || fromDirect || {};
        const userId = String(from['id'] || 'unknown');
        const displayName =
          (from['first_name'] as string) ||
          (from['username'] as string) ||
          userId;
        return { userId, displayName, isApproved: false };
      },
      async authorizeMessage(ctx) {
        return { allowed: true };
      },
    },

    pairing: {
      async generatePairingCode(userId: string) {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        logger.info(`Telegram 配对码: ${userId} → ${code}`);
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

export const telegramChannel = createTelegramChannel();
export { escapeMarkdownV2, buildInlineKeyboard };
