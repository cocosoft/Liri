/**
 * Telegram 通道插件
 * 厂商: Telegram, 协议: Bot API HTTP + Webhook
 * 特色: 原生 MarkdownV2 + Inline Keyboard + 文件发送
 * CDN 绕过: 支持 DNS fallback + fallback IP，绕过 api.telegram.org 封锁
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelMessageToolHints,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  MessageContext,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import { AttachmentManager } from '../../components/attachments.js';

const TELEGRAM_META: ChannelMeta = {
  id: 'telegram',
  displayName: 'Telegram',
  vendor: 'Telegram Messenger',
  vendorSite: 'https://core.telegram.org/bots/api',
  icon: '✈️',
  markdownCapable: true,
  maxMessageLength: 4096,
  supportedMessageTypes: ['text', 'image', 'file', 'markdown', 'card'],
  messageToolHints: {
    responsePreference: 'markdown',
    formattingTips: [
      '使用 MarkdownV2 格式：*bold* _italic_ `code`',
      '链接格式: [text](url)',
      '特殊字符需要转义：_ * [ ] ( ) ~ ` > # + - = | { } . !',
    ],
    recommendedMaxLength: 4000,
    platformCapabilities: [
      'markdown',
      'inline_keyboard',
      'file_upload',
      'image',
      'polling',
      'webhook',
    ],
    constraints: ['MarkdownV2 格式要求严格转义'],
  },
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

const TELEGRAM_API_HOST = 'api.telegram.org';
const TELEGRAM_API_BASE = `https://${TELEGRAM_API_HOST}`;
const TELEGRAM_BOT_API = `https://${TELEGRAM_API_HOST}/bot`;

/** DoH 发现超时（毫秒） */
const DOH_TIMEOUT_MS = 4000;

/** DoH 提供商列表 */
interface DoHProvider {
  url: string;
  params: Record<string, string>;
  headers: Record<string, string>;
}

const DOH_PROVIDERS: DoHProvider[] = [
  {
    url: 'https://dns.google/resolve',
    params: { name: TELEGRAM_API_HOST, type: 'A' },
    headers: {},
  },
  {
    url: 'https://cloudflare-dns.com/dns-query',
    params: { name: TELEGRAM_API_HOST, type: 'A' },
    headers: { Accept: 'application/dns-json' },
  },
];

/** 种子 fallback IP（当 DoH 也被封锁时使用） */
const SEED_FALLBACK_IPS: string[] = [
  '149.154.167.220',
  '149.154.167.99',
  '149.154.171.5',
];

/**
 * TelegramFallbackTransport — CDN 封锁绕过传输层
 *
 * 当默认 api.telegram.org 不可达时，通过 DNS-over-HTTPS 发现
 * fallback IP，然后用 IP 直连并携带 Host 头的方式绕过封锁。
 * 对齐 Hermes telegram_network.py 的设计模式。
 */
class TelegramFallbackTransport {
  private currentBaseUrl = TELEGRAM_API_BASE;
  private fallbackIps: string[] = [];
  private stickyIp: string | null = null;
  private lastFailoverTime = 0;
  private readonly failoverCooldown = 300_000; // 5 分钟冷却
  private discoveryDone = false;

  /** 获取当前使用的 API base URL */
  get baseUrl(): string {
    return this.currentBaseUrl;
  }

  /** 获取当前 sticky IP（调试用） */
  get currentIp(): string | null {
    return this.stickyIp;
  }

  /**
   * 发现 fallback IP（仅执行一次）
   * 先通过 DoH 查询，失败后回退到种子 IP
   */
  async discoverFallbackIps(): Promise<string[]> {
    if (this.discoveryDone && this.fallbackIps.length > 0) {
      return this.fallbackIps;
    }

    // 第一步：通过 DoH 发现
    const dohIps = await this.queryDohProviders();
    if (dohIps.length > 0) {
      this.fallbackIps = dohIps;
      this.discoveryDone = true;
      return this.fallbackIps;
    }

    // 第二步：回退到种子 IP
    this.fallbackIps = [...SEED_FALLBACK_IPS];
    this.discoveryDone = true;
    return this.fallbackIps;
  }

  /**
   * 查询所有 DoH 提供商，收集 Telegram API IP
   */
  private async queryDohProviders(): Promise<string[]> {
    const seen = new Set<string>();
    const ips: string[] = [];

    for (const provider of DOH_PROVIDERS) {
      try {
        const url = new URL(provider.url);
        for (const [key, value] of Object.entries(provider.params)) {
          url.searchParams.set(key, value);
        }
        const resp = await fetch(url.toString(), {
          headers: { ...provider.headers, Accept: 'application/dns-json' },
          signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
        });
        if (!resp.ok) continue;

        const data = (await resp.json()) as {
          Answer?: Array<{ type: number; data: string }>;
        };
        if (!data.Answer) continue;

        for (const answer of data.Answer) {
          if (answer.type !== 1) continue;
          const ip = answer.data.trim();
          if (ip && !seen.has(ip)) {
            seen.add(ip);
            ips.push(ip);
          }
        }
      } catch {
        // 单个 DoH 失败不影响其他
      }
    }

    return ips;
  }

  /**
   * 执行一次 API 调用，自动处理 fallback
   */
  async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.currentBaseUrl}${endpoint}`;
    try {
      const resp = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        if (this.stickyIp && this.canRetryDefault()) {
          this.tryRestoreDefault().catch(() => {});
        }
        return resp;
      }
      return resp;
    } catch {
      return this.fetchWithFallback(endpoint, options);
    }
  }

  /**
   * 使用 fallback IP 重试
   */
  private async fetchWithFallback(
    endpoint: string,
    options: RequestInit
  ): Promise<Response> {
    const now = Date.now();
    if (now - this.lastFailoverTime < this.failoverCooldown && this.stickyIp) {
      const ipUrl = `https://${this.stickyIp}${endpoint}`;
      const resp = await fetch(ipUrl, {
        ...options,
        headers: {
          ...((options.headers as Record<string, string>) || {}),
          host: TELEGRAM_API_HOST,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) return resp;
    }

    await this.discoverFallbackIps();

    this.lastFailoverTime = now;
    for (const ip of this.fallbackIps) {
      try {
        const ipUrl = `https://${ip}${endpoint}`;
        const resp = await fetch(ipUrl, {
          ...options,
          headers: {
            ...((options.headers as Record<string, string>) || {}),
            host: TELEGRAM_API_HOST,
          },
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          this.stickyIp = ip;
          this.currentBaseUrl = `https://${ip}`;
          return resp;
        }
      } catch {
        continue;
      }
    }

    throw new Error('Telegram API 所有 fallback IP 均不可达');
  }

  /**
   * 检查是否能重试默认 endpoint
   */
  private canRetryDefault(): boolean {
    return Date.now() - this.lastFailoverTime > this.failoverCooldown;
  }

  /**
   * 尝试恢复默认 api.telegram.org
   */
  private async tryRestoreDefault(): Promise<void> {
    try {
      const resp = await fetch(`https://${TELEGRAM_API_HOST}/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok || resp.status < 500) {
        this.stickyIp = null;
        this.currentBaseUrl = TELEGRAM_API_BASE;
      }
    } catch {
      // 恢复失败，保持现有 fallback
    }
  }
}

class TelegramChannel extends BaseChannelPlugin {
  private readonly transport = new TelegramFallbackTransport();
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

    const resp = await this.transport.fetch(`/bot${this.botToken}/getMe`);
    const data = (await resp.json()) as Record<string, unknown>;
    if (!data['ok']) {
      throw new Error(`Telegram: ${data['description'] || 'getMe 失败'}`);
    }

    if (this.webhookUrl) {
      await this.transport.fetch(
        `/bot${this.botToken}/setWebhook?url=${encodeURIComponent(this.webhookUrl)}`
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
      const resp = await this.transport.fetch(`/bot${this.botToken}/getMe`);
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
    const resp = await this.transport.fetch(
      `/bot${this.botToken}/sendMessage`,
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
    const resp = await this.transport.fetch(
      `/bot${this.botToken}/sendMessage`,
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
    const resp = await this.transport.fetch(`/bot${this.botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
    const resp = await this.transport.fetch(
      `/bot${this.botToken}/sendDocument`,
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
    const resp = await this.transport.fetch(
      `/bot${this.botToken}/sendMessage`,
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

  /**
   * 下载 Telegram 文件（语音/附件）
   * @param fileId Telegram 文件 ID
   * @returns 本地保存路径
   */
  private async downloadTelegramFile(fileId: string): Promise<string> {
    const fileResp = await this.transport.fetch(
      `/bot${this.botToken}/getFile?file_id=${fileId}`
    );
    const fileData = (await fileResp.json()) as Record<string, unknown>;
    if (!fileData['ok']) {
      throw new Error(
        `获取文件信息失败: ${fileData['description'] || 'unknown'}`
      );
    }
    const result = fileData['result'] as Record<string, unknown>;
    const filePath = result['file_path'] as string;
    if (!filePath) {
      throw new Error('Telegram 未返回文件路径');
    }
    const fileUrl = `https://${TELEGRAM_API_HOST}/file/bot${this.botToken}/${filePath}`;
    const fileResp2 = await fetch(fileUrl);
    if (!fileResp2.ok) {
      throw new Error(`下载文件失败: HTTP ${fileResp2.status}`);
    }
    const audioBuffer = Buffer.from(await fileResp2.arrayBuffer());
    const fileName = filePath.split('/').pop() || `voice_${fileId}.ogg`;
    const attachmentManager = new AttachmentManager();
    const attachment = attachmentManager.saveAttachment(
      fileName,
      audioBuffer,
      'file',
      'audio/ogg',
      { source: 'telegram', fileId }
    );

    return attachment.path;
  }

  private async pollUpdates(): Promise<void> {
    if (!this.shouldPoll || !this.botToken) return;

    try {
      const resp = await this.transport.fetch(
        `/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`
      );
      const data = (await resp.json()) as Record<string, unknown>;

      if (data['ok'] === true) {
        const result = data['result'] as Array<Record<string, unknown>>;
        for (const update of result) {
          const updateId = update['update_id'] as number;
          this.lastUpdateId = updateId;

          const msg = update['message'] as Record<string, unknown> | undefined;
          if (!msg) continue;

          const chat = msg['chat'] as Record<string, unknown>;
          const from = msg['from'] as Record<string, unknown>;
          const chatType = chat['type'] as string;

          // 检测语音消息
          const voice = msg['voice'] as Record<string, unknown> | undefined;
          if (voice) {
            const fileId = voice['file_id'] as string;
            const duration = (voice['duration'] as number) || 0;
            const mimeType = (voice['mime_type'] as string) || 'audio/ogg';

            let filePath = '';
            try {
              filePath = await this.downloadTelegramFile(fileId);
            } catch (error) {
              this.logger.error('Telegram 语音文件下载失败', {
                fileId,
                error: String(error),
              });
            }

            const voiceMessage: MessageContext = {
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
              messageType: 'voice',
              content: filePath
                ? `[语音消息] (时长: ${duration}s, 已保存: ${filePath})`
                : `[语音消息] (时长: ${duration}s)`,
              timestamp: (msg['date'] as number) * 1000,
              isDirectMessage: chatType === 'private',
              rawPayload: update as unknown as Record<string, unknown>,
            };

            this.handleIncomingMessage(voiceMessage).catch((error) => {
              this.logger.error('Telegram 语音消息处理异常', {
                error: String(error),
              });
            });
            continue;
          }

          // 仅处理文本消息
          if (!msg['text']) continue;

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
