import net from 'net';
import tls from 'tls';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  MessageContext,
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { TTLCache } from '@modules/utils/cache';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('channels:irc:IrcChannel');

const IRC_LINE_MAX = 480;
const IRC_MSG_CHUNK_MAX = 350;
const IRC_CONNECT_TIMEOUT_MS = 15000;
const IRC_READY_TIMEOUT_MS = 30000;

/**
 * IRC 配置
 */
export interface IrcConfig {
  enabled: boolean;
  server: string;
  port: number;
  nickname: string;
  username?: string;
  realname?: string;
  password?: string;
  nickservPassword?: string;
  channels: string[];
  tls: boolean;
}

export interface ParsedIrcLine {
  raw: string;
  prefix?: string;
  command: string;
  params: string[];
  trailing?: string;
}

export interface ParsedIrcPrefix {
  nick?: string;
  user?: string;
  host?: string;
  server?: string;
}

/**
 * 解析 IRC 协议行 :prefix COMMAND param1 param2 :trailing
 */
function parseIrcLine(line: string): ParsedIrcLine | null {
  const raw = line.replace(/[\r\n]+/g, '').trim();
  if (!raw) return null;

  let cursor = raw;
  let prefix: string | undefined;

  if (cursor.startsWith(':')) {
    const idx = cursor.indexOf(' ');
    if (idx <= 1) return null;
    prefix = cursor.slice(1, idx);
    cursor = cursor.slice(idx + 1).trimStart();
  }

  if (!cursor) return null;

  const firstSpace = cursor.indexOf(' ');
  const command = (
    firstSpace === -1 ? cursor : cursor.slice(0, firstSpace)
  ).trim();
  if (!command) return null;

  cursor = firstSpace === -1 ? '' : cursor.slice(firstSpace + 1);
  const params: string[] = [];
  let trailing: string | undefined;

  while (cursor.length > 0) {
    cursor = cursor.trimStart();
    if (!cursor) break;
    if (cursor.startsWith(':')) {
      trailing = cursor.slice(1);
      break;
    }
    const spaceIdx = cursor.indexOf(' ');
    if (spaceIdx === -1) {
      params.push(cursor);
      break;
    }
    params.push(cursor.slice(0, spaceIdx));
    cursor = cursor.slice(spaceIdx + 1);
  }

  return { raw, prefix, command: command.toUpperCase(), params, trailing };
}

/**
 * 解析 IRC 前缀（nick!user@host）
 */
function parseIrcPrefix(prefix?: string): ParsedIrcPrefix {
  if (!prefix) return {};

  const nickPart = prefix.match(/^([^!@]+)!([^@]+)@(.+)$/);
  if (nickPart) {
    return { nick: nickPart[1], user: nickPart[2], host: nickPart[3] };
  }

  const nickHost = prefix.match(/^([^@]+)@(.+)$/);
  if (nickHost) {
    return { nick: nickHost[1], host: nickHost[2] };
  }

  if (prefix.includes('.')) {
    return { server: prefix };
  }

  return { nick: prefix };
}

/**
 * 清理 IRC 输出文本（移除控制字符、换行）
 */
function sanitizeIrcText(text: string): string {
  const ctrlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  return text.replace(/\r?\n/g, ' ').replace(ctrlChars, '').trim();
}

/**
 * 验证 IRC 目标（频道或昵称）合法性
 */
function sanitizeIrcTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('IRC target is required');
  if (!/^[^\s:]+$/.test(trimmed)) {
    throw new Error(`Invalid IRC target: ${raw}`);
  }
  return trimmed;
}

/**
 * 将长消息拆分为多个 IRC 可发送的段
 */
function splitIrcText(text: string, maxChars = IRC_MSG_CHUNK_MAX): string[] {
  const cleaned = sanitizeIrcText(text);
  if (!cleaned) return [];

  if (cleaned.length <= maxChars) return [cleaned];

  const chunks: string[] = [];
  let remaining = cleaned;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(' ', maxChars);
    if (splitAt < Math.floor(maxChars * 0.5)) {
      splitAt = maxChars;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

/**
 * 生成回退昵称（在昵称冲突时使用）
 */
function buildFallbackNick(nick: string): string {
  const safe = nick.replace(/[^A-Za-z0-9_\-[\]\\`^{}|]/g, '');
  const base = safe || 'pyapp';
  const suffix = '_';
  const maxLen = 30;
  if (base.length >= maxLen) {
    return `${base.slice(0, maxLen - suffix.length)}${suffix}`;
  }
  return `${base}${suffix}`;
}

const IRC_META: ChannelMeta = {
  id: 'irc',
  displayName: 'IRC',
  vendor: 'IRC',
  vendorSite: 'https://ircv3.net',
  icon: 'irc',
  markdownCapable: false,
  maxMessageLength: IRC_LINE_MAX,
  supportedMessageTypes: ['text'],
};

const IRC_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: false,
};

/**
 * 消息去重缓存（基于 eventId 的滑动窗口）
 * IRC 没有消息 ID，使用 sender + text + timestamp 组合
 */
class IrcDedup {
  private cache = new TTLCache<number>(10000, 5000);

  claim(key: string): boolean {
    if (this.cache.has(key)) return false;
    this.cache.set(key, Date.now());
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

class IrcChannelPlugin extends BaseChannelPlugin {
  readonly id = 'irc';
  readonly meta = IRC_META;
  readonly capabilities = IRC_CAPABILITIES;

  private socket: net.Socket | null = null;
  private connectionConfig!: IrcConfig;
  private ready = false;
  private closed = false;
  private currentNick = '';
  private desiredNick = '';
  private buffer = '';
  private nickServRecovered = false;
  private fallbackUsed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private dedup = new IrcDedup();
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['nickname'] as string) || 'unknown',
        displayName: (sender['nickname'] as string) || 'unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      server: '',
      port: 6667,
      nickname: 'Liri_bot',
      username: 'Liri_bot',
      realname: 'Liri Bot',
      password: '',
      nickservPassword: '',
      channels: [],
      tls: false,
      reconnectDelayMs: 5000,
      maxReconnectAttempts: 10,
      lineMax: 480,
      msgChunkMax: 350,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['server']) errors.push('缺少 server');
    if (!config['nickname']) errors.push('缺少 nickname');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    const raw = config as Record<string, unknown>;
    this.connectionConfig = {
      enabled: (raw['enabled'] as boolean) ?? true,
      server: (raw['server'] as string) || '',
      port: (raw['port'] as number) || (raw['tls'] ? 6697 : 6667),
      nickname: (raw['nickname'] as string) || 'Liri_bot',
      username:
        (raw['username'] as string) ||
        (raw['nickname'] as string) ||
        'Liri_bot',
      realname: (raw['realname'] as string) || 'Liri Bot',
      password: (raw['password'] as string) || '',
      nickservPassword: (raw['nickservPassword'] as string) || '',
      channels: (raw['channels'] as string[]) || [],
      tls: (raw['tls'] as boolean) ?? false,
    };

    this.desiredNick = this.connectionConfig.nickname;
    this.currentNick = this.desiredNick;
    this.closed = false;
    this.ready = false;
    this.buffer = '';
    this.nickServRecovered = false;
    this.fallbackUsed = false;
    this.dedup.clear();

    await this.connectSocket();
  }

  protected override async onDisconnect(): Promise<void> {
    this.closed = true;
    this.ready = false;
    this.clearPing();
    if (this.socket) {
      try {
        this.sendRaw('QUIT :bye');
      } catch (err) {
        await handleError(err, {
          module: 'channels:irc',
          action: 'onDisconnect',
        });
        // 忽略 QUIT 发送失败
      }
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * 建立 TCP/TLS 连接到 IRC 服务器
   */
  private async connectSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`IRC 连接超时 (${IRC_CONNECT_TIMEOUT_MS}ms)`));
      }, IRC_CONNECT_TIMEOUT_MS);

      this.connectResolve = resolve;
      this.connectReject = reject;

      const opts: net.TcpSocketConnectOpts = {
        host: this.connectionConfig.server,
        port: this.connectionConfig.port,
      };

      this.socket = this.connectionConfig.tls
        ? tls.connect({ ...opts, servername: this.connectionConfig.server })
        : net.connect(opts);

      this.socket.setEncoding('utf8');

      this.socket.on('connect', () => {
        this.logger.info('IRC TCP 连接已建立', {
          server: this.connectionConfig.server,
          port: this.connectionConfig.port,
          tls: this.connectionConfig.tls,
        });

        if (this.connectionConfig.password) {
          this.sendRaw(`PASS ${this.connectionConfig.password}`);
        }
        this.sendRaw(`NICK ${this.connectionConfig.nickname}`);
        this.sendRaw(
          `USER ${this.connectionConfig.username} 0 * :${this.connectionConfig.realname}`
        );
      });

      this.socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        let idx = this.buffer.indexOf('\n');
        while (idx !== -1) {
          const rawLine = this.buffer.slice(0, idx).replace(/\r$/, '');
          this.buffer = this.buffer.slice(idx + 1);
          idx = this.buffer.indexOf('\n');
          if (rawLine) {
            this.handleLine(rawLine);
          }
        }
      });

      this.socket.on('close', (hadError) => {
        this.logger.warn('IRC 连接已关闭', { hadError });
        this.clearPing();
        this.ready = false;

        if (this.connectReject) {
          clearTimeout(timeout);
          this.connectReject(new Error('IRC 连接在完全建立前关闭'));
          this.connectReject = null;
          this.connectResolve = null;
        }

        if (!this.closed && this.inboundListening) {
          this.logger.info('IRC 将在 10 秒后自动重连...');
          setTimeout(() => {
            this.connectSocket().catch((err) => {
              handleError(err, {
                module: 'channels:irc',
                action: 'IRC 重连失败',
              });
            });
          }, 10000);
        }
      });

      this.socket.on('error', (err) => {
        this.logger.error('IRC socket 错误', { error: err.message });
        if (this.connectReject) {
          clearTimeout(timeout);
          this.connectReject(err);
          this.connectReject = null;
          this.connectResolve = null;
        }
      });
    });
  }

  private sendRaw(line: string): void {
    if (!this.socket) throw new Error('IRC 未连接');
    const cleaned = line.replace(/[\r\n]+/g, '').trim();
    if (!cleaned) return;
    this.logger.debug('IRC >>', { line: cleaned });
    this.socket.write(`${cleaned}\r\n`);
  }

  private handleLine(rawLine: string): void {
    const parsed = parseIrcLine(rawLine);
    if (!parsed) return;

    if (parsed.command === 'PING') {
      const payload = parsed.trailing ?? parsed.params[0] ?? '';
      this.sendRaw(`PONG :${payload}`);
      return;
    }

    if (parsed.command === 'PRIVMSG') {
      this.handlePrivmsg(parsed);
      return;
    }

    if (parsed.command === '001') {
      this.onRegistered();
      return;
    }

    if (parsed.command === '433' || parsed.command === '436') {
      this.handleNickCollision();
      return;
    }

    if (parsed.command === 'NICK') {
      const prefix = parseIrcPrefix(parsed.prefix);
      const newNick = parsed.trailing ?? parsed.params[0] ?? '';
      const normalizedCurrent = this.currentNick.toLowerCase();
      const normalizedPrefix = (prefix.nick ?? '').toLowerCase();
      if (normalizedPrefix === normalizedCurrent) {
        this.currentNick = newNick;
        this.logger.info('IRC 昵称已变更', { newNick });
      }
    }
  }

  private onRegistered(): void {
    this.ready = true;
    this.logger.info('IRC 连接就绪', {
      server: this.connectionConfig.server,
      nick: this.currentNick,
    });

    // NickServ 认证
    if (this.connectionConfig.nickservPassword) {
      this.sendRaw(
        `PRIVMSG NickServ :IDENTIFY ${this.connectionConfig.nickservPassword}`
      );
    }

    // 加入频道
    for (const channel of this.connectionConfig.channels) {
      const target = sanitizeIrcTarget(channel);
      if (target.startsWith('#') || target.startsWith('&')) {
        this.sendRaw(`JOIN ${target}`);
      }
    }

    if (this.connectResolve) {
      clearTimeout(30000);
      this.connectResolve();
      this.connectResolve = null;
      this.connectReject = null;
    }

    this.startPing();
  }

  private handleNickCollision(): void {
    if (!this.nickServRecovered && this.connectionConfig.nickservPassword) {
      this.nickServRecovered = true;
      try {
        const ghostTarget = sanitizeIrcTarget(
          this.connectionConfig.nickservPassword
        );
        this.sendRaw(
          `PRIVMSG NickServ :GHOST ${this.desiredNick} ${ghostTarget}`
        );
        this.sendRaw(`NICK ${this.desiredNick}`);
        this.logger.info('IRC 尝试 NickServ GHOST 恢复昵称');
        return;
      } catch (err) {
        handleError(err, {
          module: 'channels:irc',
          action: 'handleNickCollision',
        });
        // GHOST 失败，回退
      }
    }

    if (!this.fallbackUsed) {
      this.fallbackUsed = true;
      const fallback = buildFallbackNick(this.desiredNick);
      this.sendRaw(`NICK ${fallback}`);
      this.currentNick = fallback;
      this.logger.info('IRC 使用回退昵称', { fallback });
    }
  }

  private handlePrivmsg(parsed: ParsedIrcLine): void {
    const prefix = parseIrcPrefix(parsed.prefix);
    const senderNick = prefix.nick || 'unknown';
    const target = parsed.params[0] || '';
    const text = parsed.trailing || '';

    if (!text) return;

    // 去重
    const dedupKey = `${senderNick}:${target}:${text}`;
    if (!this.dedup.claim(dedupKey)) return;

    const isChannel = target.startsWith('#') || target.startsWith('&');
    const msgId = randomUUID();

    const ctx: MessageContext = {
      channelId: 'irc',
      senderId: senderNick,
      senderName: senderNick,
      groupId: isChannel ? target : undefined,
      conversationId: isChannel ? target : senderNick,
      messageId: msgId,
      messageType: 'text',
      content: text,
      timestamp: Date.now(),
      isDirectMessage: !isChannel,
      rawPayload: {
        nickname: senderNick,
        username: prefix.user || '',
        hostname: prefix.host || '',
        target,
        text,
        channel: isChannel ? target : '',
        rawLine: parsed.raw,
      },
    };

    this.handleIncomingMessage(ctx).catch((err) => {
      handleError(err, {
        module: 'channels:irc',
        action: 'IRC 消息处理异常',
      });
    });
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      try {
        this.sendRaw('PING :pyapp-keepalive');
      } catch {
        this.clearPing();
      }
    }, 60000);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.ready || !this.socket) {
      return { success: false, error: 'IRC 未连接' };
    }
    try {
      const safeTarget = sanitizeIrcTarget(target);
      const chunks = splitIrcText(content);
      for (const chunk of chunks) {
        this.sendRaw(`PRIVMSG ${safeTarget} :${chunk}`);
      }
      return { success: true };
    } catch (e) {
      await handleError(e, {
        module: 'channels:irc',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    _target: string,
    _imageUrl: string
  ): Promise<SendResult> {
    return { success: false, error: 'IRC: 不支持图片消息' };
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'IRC: 不支持文件消息' };
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    const sockAlive = this.socket !== null && !this.socket.destroyed;
    const ready = this.ready;
    return {
      healthy: sockAlive && ready,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * 创建入站适配器（基于 TCP Socket 的 IRC 协议）
   *
   * 注意：协议标注为 'websocket' 是为了与监控/协议统计兼容（IRC 使用持久 TCP 连接，
   * 行为上最接近 WebSocket 长连接模式）。实际传输层为 Node.js net.Socket（原始 TCP）。
   *
   * start() 为空操作是因为 TCP 连接由 BaseChannelPlugin 生命周期管理
   * （onConnect → connectSocket → TCP 握手 → 消息到达后由 messageHandler 分发）。
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'websocket' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.info('IRC 入站消息监听启动');
        self.setInboundListening(true);
      },

      stop: async (): Promise<void> => {
        self.closed = true;
        self.ready = false;
        self.clearPing();
        if (self.socket) {
          try {
            self.sendRaw('QUIT :bye');
          } catch (err) {
            await handleError(err, { module: 'channels:irc', action: 'stop' });
          }
          self.socket.destroy();
          self.socket = null;
        }
        self.setInboundListening(false);
        self.logger.info('IRC 入站消息监听已停止');
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  /**
   * 加入频道（运行时动态加入）
   */
  async join(channel: string): Promise<boolean> {
    if (!this.ready) return false;
    try {
      const target = sanitizeIrcTarget(channel);
      if (!target.startsWith('#') && !target.startsWith('&')) return false;
      this.sendRaw(`JOIN ${target}`);
      if (!this.connectionConfig.channels.includes(target)) {
        this.connectionConfig.channels.push(target);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 离开频道
   */
  async part(channel: string): Promise<boolean> {
    if (!this.ready) return false;
    try {
      const target = sanitizeIrcTarget(channel);
      this.sendRaw(`PART ${target}`);
      this.connectionConfig.channels = this.connectionConfig.channels.filter(
        (c) => c !== target
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function createIrcChannel(): IChannelPlugin {
  return new IrcChannelPlugin();
}

export const ircChannelPlugin = createIrcChannel();
