/**
 * Discord 通道插件
 * 厂商: Discord Inc., 协议: Gateway WebSocket + HTTP REST API
 * 特色: Slash Command / Embed / Webhook
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

interface DiscordState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  botToken: string;
  clientId: string;
  gatewayUrl: string;
  heartbeatInterval: number;
  sequence: number | null;
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';

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

function createDiscordChannel(): IChannelPlugin {
  const state: DiscordState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
    botToken: '',
    clientId: '',
    gatewayUrl: '',
    heartbeatInterval: 41250,
    sequence: null,
  };

  return {
    id: 'discord',
    meta: DISCORD_META,
    capabilities: DISCORD_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['botToken']) errors.push('缺少 botToken (Discord Bot Token)');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return { botToken: '', clientId: '', gatewayIntents: 512 };
      },
    },

    lifecycle: {
      async connect(config: Record<string, unknown>) {
        state.botToken = (config['botToken'] as string) || '';
        state.clientId = (config['clientId'] as string) || '';

        if (!state.botToken) throw new AppError(
          'Discord: botToken 是必需的',
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'INVALID_INPUT',
          { channel: 'discord', missing: ['botToken'] }
        );

        state.startTime = Date.now();

        try {
          // 获取 Gateway URL
          const gwResp = await fetch(`${DISCORD_API_BASE}/gateway/bot`, {
            headers: { Authorization: `Bot ${state.botToken}` },
          });
          const gwData = (await gwResp.json()) as Record<string, unknown>;
          state.gatewayUrl =
            (gwData['url'] as string) || 'wss://gateway.discord.gg';

          // 验证 Token 有效性
          const appResp = await fetch(
            `${DISCORD_API_BASE}/oauth2/applications/@me`,
            {
              headers: { Authorization: `Bot ${state.botToken}` },
            }
          );
          if (!appResp.ok) {
            throw new AppError(
              `Discord: Token 无效 ${appResp.status}`,
              ErrorCategory.API,
              ErrorSeverity.HIGH,
              'API_ERROR',
              { channel: 'discord', status: appResp.status }
            );
          }

          state.connected = true;
          logger.info('Discord 通道已连接（HTTP REST 模式）');
        } catch (err) {
          logger.error('Discord 连接失败', err as Error);
          throw err;
        }
      },

      async disconnect() {
        state.connected = false;
        logger.info('Discord 通道已断开');
      },

      async healthCheck() {
        const start = Date.now();
        if (!state.botToken) return { healthy: false, latencyMs: 0 };
        try {
          const resp = await fetch(`${DISCORD_API_BASE}/gateway/bot`, {
            headers: { Authorization: `Bot ${state.botToken}` },
          });
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
            content: content.slice(0, DISCORD_META.maxMessageLength),
          };
          const resp = await fetch(
            `${DISCORD_API_BASE}/channels/${target}/messages`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bot ${state.botToken}`,
              },
              body: JSON.stringify(body),
            }
          );
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
        // Discord 使用自己的 markdown 子集，直接作为普通文本发送
        return this.sendText(target, content);
      },

      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const body = {
            embeds: [
              {
                image: { url: imageUrl },
              },
            ],
          };
          const resp = await fetch(
            `${DISCORD_API_BASE}/channels/${target}/messages`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bot ${state.botToken}`,
              },
              body: JSON.stringify(body),
            }
          );
          const data = (await resp.json()) as Record<string, unknown>;
          return { success: resp.ok, error: data['message'] as string };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },

      async sendFile(target: string, filePath: string): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
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
              headers: { Authorization: `Bot ${state.botToken}` },
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
      },

      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        if (!state.botToken) return { success: false, error: '未连接' };
        try {
          const embed = buildDiscordEmbed(card);
          const body = { embeds: [embed] };

          if (card.buttons && card.buttons.length > 0) {
            (body as Record<string, unknown>)['components'] = [
              {
                type: 1,
                components: card.buttons.map((b) => ({
                  type: 2,
                  style:
                    b.style === 'danger' ? 4 : b.style === 'primary' ? 1 : 2,
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
                Authorization: `Bot ${state.botToken}`,
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
    },

    security: {
      dmPolicy: 'pairing',
      allowFrom: [],
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 5,
      async resolveSender(sender: Record<string, unknown>) {
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
      async authorizeMessage(ctx) {
        return { allowed: true };
      },
    },

    pairing: {
      async generatePairingCode(userId: string) {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        logger.info(`Discord 配对码: ${userId} → ${code}`);
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

export const discordChannel = createDiscordChannel();
export { buildDiscordEmbed };
