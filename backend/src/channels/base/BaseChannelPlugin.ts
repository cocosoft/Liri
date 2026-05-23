import type {
  IChannelPlugin,
  ChannelId,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  DmPolicy,
  SendResult,
  InteractiveCard,
  ResolvedSender,
  MessageContext,
  IChannelConfigAdapter,
  IChannelLifecycleAdapter,
  IChannelOutboundAdapter,
  IChannelSecurityAdapter,
  IChannelPairingAdapter,
} from '@modules/channels/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export interface ChannelPluginState {
  connected: boolean;
  lastMessageAt: number | null;
  startTime: number;
  error?: string;
}

/**
 * BaseChannelPlugin — 通道插件抽象基类
 *
 * 提供 IChannelPlugin 的标准实现骨架，消除各渠道中重复的样板代码：
 * - ChannelStatus 状态追踪 (connected/lastMessageAt/startTime)
 * - Logger 集成
 * - 标准 config.validate() 和 config.getDefaultConfig()
 * - 标准 lifecycle.connect/disconnect/healthCheck/getStatus()
 * - 标准 outbound.sendText/sendMarkdown/sendImage/sendFile/sendInteractive()
 * - 标准 security 默认实现
 *
 * 子类需实现：
 * - id / meta / capabilities — 渠道标识与元数据
 * - getDefaultConfig() / validateConfig() — 配置管理
 * - onConnect() — 渠道特有连接逻辑（API 认证、WebSocket 握手等）
 * - sendTextMessage() / sendImageMessage() / sendFileMessage() — 消息发送
 */
export abstract class BaseChannelPlugin implements IChannelPlugin {
  // ─── 子类必须定义的渠道属性 ───────────────────────────────
  abstract readonly id: ChannelId;
  abstract readonly meta: ChannelMeta;
  abstract readonly capabilities: ChannelCapabilities;

  // ─── Logger ──────────────────────────────────────────────
  protected readonly logger: Logger;

  // ─── 内部状态 ────────────────────────────────────────────
  private _state: ChannelPluginState = {
    connected: false,
    lastMessageAt: null,
    startTime: 0,
  };

  protected get state(): Readonly<ChannelPluginState> {
    return this._state;
  }

  constructor() {
    this.logger = new Logger({ level: LogLevel.INFO });
  }

  // ─── 子类必须实现的方法 ──────────────────────────────────
  protected abstract getDefaultConfig(): Record<string, unknown>;
  protected abstract validateConfig(config: Record<string, unknown>): string[];
  protected abstract onConnect(config: Record<string, unknown>): Promise<void>;
  protected abstract sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult>;
  protected abstract sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult>;
  protected abstract sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult>;

  // ─── 可覆写的方法（默认行为） ────────────────────────────
  protected onDisconnect(): Promise<void> {
    return Promise.resolve();
  }

  protected async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, content);
  }

  protected async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const text = `${card.title}\n${card.content}`;
    return this.sendTextMessage(target, text);
  }

  protected async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    return { healthy: this._state.connected, latencyMs: 0 };
  }

  // ─── IChannelConfigAdapter ──────────────────────────────
  readonly config: IChannelConfigAdapter = {
    validate: (config: Record<string, unknown>) => {
      const errors = this.validateConfig(config);
      return { valid: errors.length === 0, errors };
    },
    getDefaultConfig: () => this.getDefaultConfig(),
  };

  // ─── IChannelLifecycleAdapter ───────────────────────────
  readonly lifecycle: IChannelLifecycleAdapter = {
    connect: async (config: Record<string, unknown>) => {
      const errors = this.validateConfig(config);
      if (errors.length > 0) {
        throw new AppError(
          `配置验证失败: ${errors.join('; ')}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'INVALID_CONFIG',
          { channel: this.id, errors }
        );
      }
      this._state = {
        connected: false,
        lastMessageAt: null,
        startTime: Date.now(),
      };
      await this.onConnect(config);
      this._state = { ...this._state, connected: true };
      this.logger.info(`${this.id} 通道已连接`);
    },

    disconnect: async () => {
      this._state = { ...this._state, connected: false };
      await this.onDisconnect();
      this.logger.info(`${this.id} 通道已断开`);
    },

    healthCheck: async () => this.checkHealth(),

    getStatus: (): ChannelStatus => ({
      connected: this._state.connected,
      latencyMs: 0,
      lastMessageAt: this._state.lastMessageAt,
      uptimeMs: this._state.connected ? Date.now() - this._state.startTime : 0,
      error: this._state.error,
    }),
  };

  // ─── IChannelOutboundAdapter ────────────────────────────
  readonly outbound: IChannelOutboundAdapter = {
    sendText: async (target: string, content: string) => {
      const start = Date.now();
      const result = await this.sendTextMessage(target, content);
      result.latencyMs = Date.now() - start;
      this._state = { ...this._state, lastMessageAt: Date.now() };
      return result;
    },

    sendMarkdown: async (target: string, content: string) => {
      const start = Date.now();
      if (this.meta.markdownCapable) {
        const result = await this.sendMarkdownMessage(target, content);
        result.latencyMs = Date.now() - start;
        this._state = { ...this._state, lastMessageAt: Date.now() };
        return result;
      }
      const result = await this.sendTextMessage(target, content);
      result.latencyMs = Date.now() - start;
      this._state = { ...this._state, lastMessageAt: Date.now() };
      return result;
    },

    sendImage: async (target: string, imageUrl: string) => {
      const start = Date.now();
      const result = await this.sendImageMessage(target, imageUrl);
      result.latencyMs = Date.now() - start;
      this._state = { ...this._state, lastMessageAt: Date.now() };
      return result;
    },

    sendFile: async (target: string, filePath: string) => {
      const start = Date.now();
      const result = await this.sendFileMessage(target, filePath);
      result.latencyMs = Date.now() - start;
      this._state = { ...this._state, lastMessageAt: Date.now() };
      return result;
    },

    sendInteractive: async (target: string, card: InteractiveCard) => {
      const start = Date.now();
      const result = await this.sendInteractiveMessage(target, card);
      result.latencyMs = Date.now() - start;
      this._state = { ...this._state, lastMessageAt: Date.now() };
      return result;
    },
  };

  // ─── IChannelSecurityAdapter ────────────────────────────
  security: IChannelSecurityAdapter = {
    dmPolicy: 'pairing' as DmPolicy,
    allowFrom: [],
    pairingCodeTimeoutMs: 300000,
    maxPairingAttempts: 5,

    resolveSender: async (_sender: Record<string, unknown>) => {
      throw new AppError(
        `${this.id}: resolveSender 未实现`,
        ErrorCategory.UNKNOWN,
        ErrorSeverity.HIGH,
        'NOT_IMPLEMENTED',
        { channel: this.id, method: 'resolveSender' }
      );
    },

    authorizeMessage: async (_ctx: MessageContext) => ({ allowed: true }),
  };

  // ─── IChannelPairingAdapter (可选) ──────────────────────
  pairing?: IChannelPairingAdapter;
}
