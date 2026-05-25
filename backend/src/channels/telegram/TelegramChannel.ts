/**
 * Telegram 通道插件
 * 厂商: Telegram, 协议: Bot API HTTP + Webhook
 * 特色: 原生 MarkdownV2 + Inline Keyboard + 文件发送
 */

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

class TelegramChannel extends BaseChannelPlugin {
  private botToken = '';
  private webhookUrl = '';

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateId = 0;
  private shouldPoll = false;
  private readonly pollingIntervalMs = 2000;

  readonly id = 'telegram';
  readonly meta = TELEGRAM_META;
  readonly capabilities = TELEGRAM_CAPABILITIES;

  constructor() {
    super();

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`Telegram 配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) => {
        return code.length === 6;
      },
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };

    this.security = {
      ...this.security,
      resolveSender: async (sender: Record<string, unknown>) => {
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
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { botToken: '', webhookPort: 8443, webhookUrl: '' };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['botToken']) errors.push('缺少 botToken (Telegram Bot Token)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.botToken = (config['botToken'] as string) || '';
    this.webhookUrl = (config['webhookUrl'] as string) || '';

    const resp = await fetch(
      `https://api.telegram.org/bot${this.botToken}/getMe`
    );
    const data = (await resp.json()) as Record<string, unknown>;
    if (!data['ok']) {
      throw new Error(`Telegram: ${data['description'] || 'getMe 失败'}`);
    }

    if (this.webhookUrl) {
      await fetch(
        `https://api.telegram.org/bot${this.botToken}/setWebhook?url=${encodeURIComponent(this.webhookUrl)}`
      );
    }

    this.logger.info(
      `Telegram 通道已连接 (Bot: ${(data['result'] as Record<string, unknown>)?.['username'] || '?'})`
    );
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    if (!this.botToken) return { healthy: false, latencyMs: 0 };
    const start = Date.now();
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getMe`
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
    const body = {
      chat_id: target,
      text: content.slice(0, TELEGRAM_META.maxMessageLength),
      parse_mode: 'HTML',
    };
    const resp = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = (await resp.json()) as Record<string, unknown>;
    const ok = data['ok'] === true;
    return {
      success: ok,
      error: ok ? undefined : (data['description'] as string),
      messageId: data['result']
        ? String((data['result'] as Record<string, unknown>)['message_id'])
        : undefined,
    };
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const escaped = escapeMarkdownV2(content);
    const body = {
      chat_id: target,
      text: escaped.slice(0, TELEGRAM_META.maxMessageLength),
      parse_mode: 'MarkdownV2',
    };
    const resp = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
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
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    const body = { chat_id: target, photo: imageUrl };
    const resp = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendPhoto`,
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
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    const file = require('node:fs').createReadStream(filePath);
    const formData = new FormData();
    formData.append('chat_id', target);
    formData.append('document', file as unknown as Blob);
    const resp = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendDocument`,
      { method: 'POST', body: formData }
    );
    const data = (await resp.json()) as Record<string, unknown>;
    return {
      success: data['ok'] === true,
      error: data['description'] as string,
    };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
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
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
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
  }

  private startPolling(): void {
    this.shouldPoll = true;
    this.lastUpdateId = 0;
    this.scheduleNextPoll();
  }

  private stopPolling(): void {
    this.shouldPoll = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleNextPoll(): void {
    if (!this.shouldPoll) return;
    this.pollTimer = setTimeout(
      () => this.pollUpdates(),
      this.pollingIntervalMs
    );
  }

  private async pollUpdates(): Promise<void> {
    if (!this.shouldPoll || !this.botToken) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`;
      const resp = await fetch(url);
      const data = (await resp.json()) as Record<string, unknown>;

      if (data['ok'] === true) {
        const result = data['result'] as Array<Record<string, unknown>>;
        for (const update of result) {
          const updateId = update['update_id'] as number;
          this.lastUpdateId = updateId;

          const msg = update['message'] as Record<string, unknown> | undefined;
          if (!msg || !msg['text']) continue;

          const chat = msg['chat'] as Record<string, unknown>;
          const from = msg['from'] as Record<string, unknown>;
          const chatType = chat['type'] as string;
          const message: MessageContext = {
            channelId: 'telegram',
            senderId: String(from['id'] || ''),
            senderName:
              (from['first_name'] as string) ||
              (from['username'] as string) ||
              '',
            groupId:
              chatType === 'group' || chatType === 'supergroup'
                ? String(chat['id'])
                : undefined,
            conversationId: String(chat['id']),
            messageId: String(msg['message_id']),
            messageType: 'text',
            content: msg['text'] as string,
            timestamp: (msg['date'] as number) * 1000,
            isDirectMessage: chatType === 'private',
            rawPayload: update as unknown as Record<string, unknown>,
          };

          this.handleIncomingMessage(message).catch((error) => {
            this.logger.error('Telegram 消息处理异常', {
              error: String(error),
            });
          });
        }
      }
    } catch (error) {
      this.logger.error('Telegram getUpdates 轮询失败', {
        error: String(error),
      });
    }

    this.scheduleNextPoll();
  }

  /**
   * 创建入站适配器（长轮询模式）
   * 使用 getUpdates API 轮询接收消息，无需公网 Webhook URL
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'polling' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.info('Telegram 入站消息轮询已启动');
        self.setInboundListening(true);
        self.startPolling();
      },

      stop: async (): Promise<void> => {
        self.stopPolling();
        self.setInboundListening(false);
        self.logger.info('Telegram 入站消息轮询已停止');
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

export function createTelegramChannel(): IChannelPlugin {
  return new TelegramChannel();
}

export const telegramChannel = createTelegramChannel();
export const telegramChannelPlugin = createTelegramChannel();
export { escapeMarkdownV2, buildInlineKeyboard };
