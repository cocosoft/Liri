/**
 * Discord 通道插件
 * 厂商: Discord Inc., 协议: Gateway WebSocket + HTTP REST API
 * 特色: Slash Command / Embed / Webhook
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const DISCORD_META: ChannelMeta = {
  id: 'discord',
  displayName: 'Discord',
  vendor: 'Discord Inc.',
  vendorSite: 'https://discord.com/developers',
  icon: '🎮',
  markdownCapable: false,
  maxMessageLength: 2000,
  supportedMessageTypes: ['text', 'image', 'file', 'card'],
};

const DISCORD_CAPABILITIES: ChannelCapabilities = {
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

const DISCORD_API_BASE = 'https://discord.com/api/v10';

interface DiscordState {
  botToken: string;
  clientId: string;
  gatewayUrl: string;
  sequence: number | null;
}

/**
 * 将 InteractiveCard 转为 Discord Embed
 */
function buildDiscordEmbed(card: InteractiveCard): Record<string, unknown> {
  const colorMap: Record<string, number> = {
    green: 0x57f287,
    yellow: 0xfee75c,
    red: 0xed4245,
    blue: 0x5865f2,
    grey: 0x99aab5,
  };
  const embed: Record<string, unknown> = {
    title: card.title,
    description: card.content.slice(0, 4096),
    color: colorMap[card.color || 'blue'],
  };
  if (card.buttons && card.buttons.length > 0) {
    embed['fields'] = card.buttons.map((b) => ({
      name: b.text,
      value: b.value,
      inline: true,
    }));
  }
  return embed;
}

class DiscordChannelPlugin extends BaseChannelPlugin {
  readonly id = 'discord';
  readonly meta = DISCORD_META;
  readonly capabilities = DISCORD_CAPABILITIES;
  private st: DiscordState = {
    botToken: '',
    clientId: '',
    gatewayUrl: '',
    sequence: null,
  };

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'pairing' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const author = sender['author'] as Record<string, unknown> | undefined;
        const userId =
          (author?.['id'] as string) ||
          ((sender['user'] as Record<string, unknown>)?.['id'] as string) ||
          'unknown';
        const displayName =
          (author?.['username'] as string) ||
          (author?.['global_name'] as string) ||
          userId;
        return { userId, displayName, isApproved: false };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`Discord 配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) =>
        code.length === 6,
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { botToken: '', clientId: '', gatewayIntents: 512 };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['botToken']) errors.push('缺少 botToken (Discord Bot Token)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.st.botToken = (config['botToken'] as string) || '';
    this.st.clientId = (config['clientId'] as string) || '';

    if (!this.st.botToken)
      throw new AppError(
        'Discord: botToken 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'discord', missing: ['botToken'] }
      );

    const gwResp = await fetch(`${DISCORD_API_BASE}/gateway/bot`, {
      headers: { Authorization: `Bot ${this.st.botToken}` },
    });
    const gwData = (await gwResp.json()) as Record<string, unknown>;
    this.st.gatewayUrl =
      (gwData['url'] as string) || 'wss://gateway.discord.gg';

    const appResp = await fetch(`${DISCORD_API_BASE}/oauth2/applications/@me`, {
      headers: { Authorization: `Bot ${this.st.botToken}` },
    });
    if (!appResp.ok) {
      throw new AppError(
        `Discord: Token 无效 ${appResp.status}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { channel: 'discord', status: appResp.status }
      );
    }

    this.logger.info('Discord 通道已连接（HTTP REST 模式）');
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    if (!this.st.botToken) return { healthy: false, latencyMs: 0 };
    try {
      const resp = await fetch(`${DISCORD_API_BASE}/gateway/bot`, {
        headers: { Authorization: `Bot ${this.st.botToken}` },
      });
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.st.botToken) return { success: false, error: '未连接' };
    try {
      const body = {
        content: content.slice(0, DISCORD_META.maxMessageLength),
      };
      const resp = await fetch(
        `${DISCORD_API_BASE}/channels/${target}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.st.botToken}`,
          },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: resp.ok,
        error: resp.ok ? undefined : (data['message'] as string),
        messageId: data['id'] as string,
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
    if (!this.st.botToken) return { success: false, error: '未连接' };
    try {
      const body = { embeds: [{ image: { url: imageUrl } }] };
      const resp = await fetch(
        `${DISCORD_API_BASE}/channels/${target}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.st.botToken}`,
          },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return { success: resp.ok, error: data['message'] as string };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    if (!this.st.botToken) return { success: false, error: '未连接' };
    try {
      const fs = require('node:fs');
      const path = require('node:path');
      const fileContent = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);

      const formData = new FormData();
      formData.append('file', new Blob([fileContent]), fileName);

      const resp = await fetch(
        `${DISCORD_API_BASE}/channels/${target}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${this.st.botToken}` },
          body: formData,
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
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    if (!this.st.botToken) return { success: false, error: '未连接' };
    try {
      const embed = buildDiscordEmbed(card);
      const body: Record<string, unknown> = { embeds: [embed] };

      if (card.buttons && card.buttons.length > 0) {
        body['components'] = [
          {
            type: 1,
            components: card.buttons.map((b) => ({
              type: 2,
              style: b.style === 'danger' ? 4 : b.style === 'primary' ? 1 : 2,
              label: b.text,
              custom_id: b.value,
            })),
          },
        ];
      }

      const resp = await fetch(
        `${DISCORD_API_BASE}/channels/${target}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.st.botToken}`,
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
  }

  /**
   * 创建入站适配器（WebSocket 协议，尚未实现）
   * TODO: 连接 Discord Gateway WebSocket，监听 MESSAGE_CREATE 事件
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.warn(
          'Discord 入站消息接收未实现（需连接 Discord Gateway WebSocket，监听 MESSAGE_CREATE 事件）'
        );
        self.setInboundListening(false);
      },

      stop: async (): Promise<void> => {
        self.setInboundListening(false);
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

function createDiscordChannel(): IChannelPlugin {
  return new DiscordChannelPlugin();
}

export const discordChannel = createDiscordChannel();
export { buildDiscordEmbed };
