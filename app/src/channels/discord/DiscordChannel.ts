/**
 * Discord 通道插件
 * 厂商: Discord Inc., 协议: Gateway WebSocket + HTTP REST API
 * 特色: Slash Command / Embed / Webhook
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import fs from 'node:fs';
import path from 'node:path';
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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { TTLCache } from '@modules/utils/cache';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('channels:discord:DiscordChannel');

interface DirectoryEntry {
  id: string;
  name: string;
  type: 'group' | 'channel' | 'user';
  parentId?: string;
  metadata?: Record<string, unknown>;
}

const DISCORD_META: ChannelMeta = {
  id: 'discord',
  displayName: 'Discord',
  vendor: 'Discord Inc.',
  vendorSite: 'https://discord.com/developers',
  icon: '🎮',
  markdownCapable: false,
  maxMessageLength: 2000,
  supportedMessageTypes: ['text', 'image', 'file', 'card'],
  messageToolHints: {
    responsePreference: 'detailed',
    formattingTips: [
      '支持 Markdown: **bold** *italic* `code` ```code block```',
      '使用 Embed 发送结构化消息',
    ],
    recommendedMaxLength: 2000,
    platformCapabilities: [
      'embed',
      'button',
      'thread',
      'reaction',
      'file_upload',
      'image',
      'webhook',
    ],
    constraints: ['消息长度限制 2000 字符', '@everyone 和 @here 自动禁用'],
  },
};

const DISCORD_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: true,
  reactions: true,
  interactive: true,
  voiceCall: true,
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

/** 消息去重（基于 messageId，60 秒窗口，与路由层 content dedup 对齐） */
class DiscordDedup {
  private cache = new TTLCache<number>(10000, 60000);

  claim(key: string): boolean {
    if (this.cache.has(key)) return false;
    this.cache.set(key, Date.now());
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** 会话存储（基于 channelId 保存最近会话信息） */
class DiscordConversationStore {
  private store = new Map<
    string,
    { guildId: string | null; lastMessageId: string; timestamp: number }
  >();
  private readonly maxEntries = 200;

  save(channelId: string, guildId: string | null, lastMessageId: string): void {
    this.store.set(channelId, {
      guildId,
      lastMessageId,
      timestamp: Date.now(),
    });
    if (this.store.size > this.maxEntries) {
      const oldest = [...this.store.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      )[0];
      if (oldest) this.store.delete(oldest[0]);
    }
  }

  get(
    channelId: string
  ): { guildId: string | null; lastMessageId: string } | undefined {
    const entry = this.store.get(channelId);
    return entry
      ? { guildId: entry.guildId, lastMessageId: entry.lastMessageId }
      : undefined;
  }

  getAll(): Array<{
    channelId: string;
    guildId: string | null;
    lastMessageId: string;
  }> {
    return [...this.store.entries()].map(([channelId, v]) => ({
      channelId,
      guildId: v.guildId,
      lastMessageId: v.lastMessageId,
    }));
  }
}

/** Discord Gateway OP Code */
const enum DiscordOp {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  PRESENCE_UPDATE = 3,
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  REQUEST_GUILD_MEMBERS = 8,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
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

/** Discord 语音服务器信息 */
interface DiscordVoiceServer {
  token: string;
  guild_id: string;
  endpoint: string | null;
}

/** Discord 语音状态信息 */
interface DiscordVoiceState {
  guildId: string;
  channelId: string | null;
  userId: string;
  sessionId: string;
  deaf: boolean;
  mute: boolean;
  selfDeaf: boolean;
  selfMute: boolean;
  selfStream: boolean;
  selfVideo: boolean;
  suppress: boolean;
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

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private hbInterval = 0;
  private seq: number | null = null;
  private dedup = new DiscordDedup();
  private convStore = new DiscordConversationStore();
  private voiceServers = new Map<string, DiscordVoiceServer>();
  private voiceStates = new Map<string, DiscordVoiceState[]>();
  private joinedVoiceChannels = new Set<string>();

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
    return {
      botToken: '',
      clientId: '',
      gatewayIntents: 512,
      gatewayUrl: 'wss://gateway.discord.gg/?v=10&encoding=json',
      restBaseUrl: 'https://discord.com/api/v10',
      reconnectDelayMs: 5000,
      maxReconnectAttempts: 10,
    };
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
        allowed_mentions: {
          parse: ['users', 'roles'],
          replied_user: false,
        },
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
      const body = {
        embeds: [{ image: { url: imageUrl } }],
        allowed_mentions: {
          parse: ['users', 'roles'],
          replied_user: false,
        },
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

  private startGateway(): void {
    if (!this.st.gatewayUrl) {
      this.logger.error('Discord Gateway 无法启动: 未获取 gatewayUrl');
      return;
    }

    const url =
      this.st.gatewayUrl.replace('wss://', 'wss://') + '/?v=10&encoding=json';
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.logger.info('Discord Gateway WebSocket 已连接');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as Record<
          string,
          unknown
        >;
        this.handleGatewayPayload(payload);
      } catch (err) {
        handleError(err, {
          module: 'channels:discord',
          action: 'onMessage',
        });
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.logger.warn('Discord Gateway WebSocket 已关闭', {
        code: event.code,
        reason: event.reason,
      });
      this.clearHeartbeat();
      this.ws = null;
      if (this.inboundListening) {
        this.logger.info('Discord Gateway 将在 5 秒后重连...');
        setTimeout(() => this.startGateway(), 5000);
      }
    };

    this.ws.onerror = (event: Event) => {
      this.logger.error('Discord Gateway WebSocket 错误', {
        error: String(event),
      });
    };
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopGateway(): void {
    this.clearHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Bot shutdown');
      this.ws = null;
    }
  }

  private handleGatewayPayload(payload: Record<string, unknown>): void {
    const op = payload['op'] as number;
    const d = payload['d'] as Record<string, unknown>;
    const seq = payload['s'] as number | null;
    const t = payload['t'] as string | undefined;

    if (seq !== null && seq !== undefined) {
      this.seq = seq;
      this.st.sequence = seq;
    }

    switch (op) {
      case DiscordOp.HELLO: {
        const heartbeatInterval =
          (d?.['heartbeat_interval'] as number) || 41250;
        this.hbInterval = heartbeatInterval;
        this.heartbeatTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({ op: DiscordOp.HEARTBEAT, d: this.seq })
            );
          }
        }, heartbeatInterval);
        this.identify();
        break;
      }

      case DiscordOp.DISPATCH: {
        if (t === 'READY') {
          const user = d?.['user'] as Record<string, unknown> | undefined;
          const userName = (user?.['username'] as string) || '?';
          this.logger.info(`Discord Gateway 已就绪 (Bot: ${userName})`);
        } else if (t === 'MESSAGE_CREATE') {
          this.handleMessageCreate(d);
        } else if (t === 'VOICE_STATE_UPDATE') {
          this.handleVoiceStateUpdate(d);
        } else if (t === 'VOICE_SERVER_UPDATE') {
          this.handleVoiceServerUpdate(d);
        }
        break;
      }

      case DiscordOp.HEARTBEAT_ACK: {
        // 心跳回复确认，无需特殊处理
        break;
      }

      case DiscordOp.RECONNECT: {
        this.logger.warn('Discord Gateway 要求重连');
        this.stopGateway();
        setTimeout(() => this.startGateway(), 1000);
        break;
      }

      case DiscordOp.INVALID_SESSION: {
        this.logger.warn('Discord Gateway Session 无效，重新识别');
        this.ws?.close(1000, 'Invalid session');
        setTimeout(() => this.startGateway(), 2000);
        break;
      }
    }
  }

  private identify(): void {
    const intents = (1 << 9) | (1 << 12) | (1 << 15) | (1 << 13); // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT | GUILD_VOICE_STATES
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: DiscordOp.IDENTIFY,
          d: {
            token: this.st.botToken,
            intents,
            properties: {
              os: 'windows',
              browser: 'pyapp',
              device: 'pyapp',
            },
          },
        })
      );
    }
  }

  private handleMessageCreate(d: Record<string, unknown>): void {
    const author = d['author'] as Record<string, unknown> | undefined;
    if (!author || author['bot'] === true) return;

    const channelId = d['channel_id'] as string;
    const guildId = d['guild_id'] as string | undefined;
    const content = (d['content'] as string) || '';
    const messageId = d['id'] as string;
    const timestamp = d['timestamp'] as string;

    // 去重
    if (!this.dedup.claim(messageId)) return;

    // 保存会话信息
    this.convStore.save(channelId, guildId || null, messageId);

    const message: MessageContext = {
      channelId: 'discord',
      senderId: String(author['id'] || ''),
      senderName:
        (author['username'] as string) ||
        (author['global_name'] as string) ||
        '',
      groupId: guildId,
      conversationId: channelId,
      messageId: messageId,
      messageType: 'text',
      content: content,
      timestamp: new Date(timestamp || Date.now()).getTime(),
      isDirectMessage: !guildId,
      rawPayload: d,
    };

    this.handleIncomingMessage(message).catch((err) => {
      handleError(err, {
        module: 'channels:discord',
        action: 'Discord 消息处理异常',
      });
    });
  }

  /**
   * 处理 VOICE_STATE_UPDATE 事件
   * 追踪用户语音频道状态
   */
  private handleVoiceStateUpdate(d: Record<string, unknown>): void {
    const guildId = d['guild_id'] as string;
    const channelId = d['channel_id'] as string | null;
    const userId = d['user_id'] as string;
    const sessionId = d['session_id'] as string;
    const voiceState: DiscordVoiceState = {
      guildId,
      channelId,
      userId,
      sessionId,
      deaf: (d['deaf'] as boolean) || false,
      mute: (d['mute'] as boolean) || false,
      selfDeaf: (d['self_deaf'] as boolean) || false,
      selfMute: (d['self_mute'] as boolean) || false,
      selfStream: (d['self_stream'] as boolean) || false,
      selfVideo: (d['self_video'] as boolean) || false,
      suppress: (d['suppress'] as boolean) || false,
    };

    // 更新该 guild 的语音状态列表
    let states = this.voiceStates.get(guildId);
    if (!states) {
      states = [];
      this.voiceStates.set(guildId, states);
    }
    if (channelId === null) {
      // 用户离开了语音频道
      const idx = states.findIndex((s) => s.userId === userId);
      if (idx >= 0) states.splice(idx, 1);
    } else {
      // 新增或更新语音状态
      const idx = states.findIndex((s) => s.userId === userId);
      if (idx >= 0) {
        states[idx] = voiceState;
      } else {
        states.push(voiceState);
      }
    }

    this.logger.debug('Discord 语音状态更新', {
      guildId,
      channelId,
      userId,
      sessionId,
      channelJoined: channelId !== null,
    });
  }

  /**
   * 处理 VOICE_SERVER_UPDATE 事件
   */
  private handleVoiceServerUpdate(d: Record<string, unknown>): void {
    const guildId = d['guild_id'] as string;
    const endpoint = d['endpoint'] as string | null;
    const token = d['token'] as string;

    this.voiceServers.set(guildId, { token, guild_id: guildId, endpoint });

    this.logger.info('Discord 语音服务器更新', {
      guildId,
      endpoint: endpoint || '无',
    });
  }

  /**
   * 加入语音频道（发送 op 4 VOICE_STATE_UPDATE）
   * 实际音频流需要 Opus/RTP 拓展，当前仅为 Discord Gateway 级别的加入
   */
  async joinVoiceChannel(guildId: string, channelId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Discord Gateway 未连接，无法加入语音频道');
      return false;
    }
    const key = `${guildId}:${channelId}`;
    if (this.joinedVoiceChannels.has(key)) {
      this.logger.info(`已在语音频道中: ${key}`);
      return true;
    }

    try {
      const payload = {
        op: DiscordOp.VOICE_STATE_UPDATE,
        d: {
          guild_id: guildId,
          channel_id: channelId,
          self_mute: false,
          self_deaf: false,
        },
      };
      this.ws.send(JSON.stringify(payload));
      this.joinedVoiceChannels.add(key);
      this.logger.info('Discord 已发送加入语音频道请求', {
        guildId,
        channelId,
      });
      return true;
    } catch (error) {
      await handleError(error, {
        module: 'channels:discord',
        action: 'joinVoiceChannel',
        context: { guildId, channelId },
      });
      return false;
    }
  }

  /**
   * 离开语音频道（发送 op 4，channel_id 设为 null）
   */
  async leaveVoiceChannel(guildId: string): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Discord Gateway 未连接，无法离开语音频道');
      return false;
    }

    try {
      const payload = {
        op: DiscordOp.VOICE_STATE_UPDATE,
        d: {
          guild_id: guildId,
          channel_id: null,
          self_mute: false,
          self_deaf: false,
        },
      };
      this.ws.send(JSON.stringify(payload));

      // 清理缓存
      for (const [key] of this.joinedVoiceChannels) {
        if (key.startsWith(`${guildId}:`)) {
          this.joinedVoiceChannels.delete(key);
        }
      }
      this.voiceServers.delete(guildId);
      this.voiceStates.delete(guildId);

      this.logger.info('Discord 已离开语音频道', { guildId });
      return true;
    } catch (error) {
      await handleError(error, {
        module: 'channels:discord',
        action: 'Discord 离开语音频道失败',
        context: { guildId },
      });
      return false;
    }
  }

  /**
   * 列出 Bot 所在的服务器
   */
  async listGuilds(): Promise<DirectoryEntry[]> {
    if (!this.st.botToken) return [];
    try {
      const resp = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: { Authorization: `Bot ${this.st.botToken}` },
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as Array<Record<string, unknown>>;
      return data.map((g) => ({
        id: g['id'] as string,
        name: g['name'] as string,
        type: 'group' as const,
        metadata: { icon: g['icon'] as string | undefined },
      }));
    } catch {
      return [];
    }
  }

  /**
   * 列出服务器中的频道
   */
  async listChannels(guildId: string): Promise<DirectoryEntry[]> {
    if (!this.st.botToken) return [];
    try {
      const resp = await fetch(
        `${DISCORD_API_BASE}/guilds/${guildId}/channels`,
        {
          headers: { Authorization: `Bot ${this.st.botToken}` },
        }
      );
      if (!resp.ok) return [];
      const data = (await resp.json()) as Array<Record<string, unknown>>;
      return data.map((ch) => ({
        id: ch['id'] as string,
        name: `#${ch['name'] as string}`,
        type: ch['type'] === 4 ? ('group' as const) : ('channel' as const),
        parentId: ch['parent_id'] as string | undefined,
        metadata: { type: ch['type'] as number },
      }));
    } catch {
      return [];
    }
  }

  /**
   * 解析用户信息
   */
  async resolveUser(
    userId: string
  ): Promise<{ userId: string; displayName: string } | null> {
    if (!this.st.botToken) return null;
    try {
      const resp = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
        headers: { Authorization: `Bot ${this.st.botToken}` },
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        userId: data['id'] as string,
        displayName:
          (data['global_name'] as string) ||
          (data['username'] as string) ||
          'Unknown',
      };
    } catch {
      return null;
    }
  }

  /**
   * 创建入站适配器（WebSocket Gateway 协议）
   * 连接 Discord Gateway WebSocket，监听 MESSAGE_CREATE 事件
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.info('Discord Gateway 入站消息监听启动');
        self.setInboundListening(true);
        self.startGateway();
      },

      stop: async (): Promise<void> => {
        self.stopGateway();
        self.setInboundListening(false);
        self.logger.info('Discord Gateway 入站消息监听已停止');
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

export function createDiscordChannel(): IChannelPlugin {
  return new DiscordChannelPlugin();
}

export const discordChannel = createDiscordChannel();
// P1-3 单例统一：Plugin 导出为同一实例别名，避免双实例
export const discordChannelPlugin = discordChannel;
export { buildDiscordEmbed };
