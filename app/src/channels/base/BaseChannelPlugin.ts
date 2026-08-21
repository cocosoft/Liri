import type {
  IChannelPlugin,
  ChannelId,
  ChannelMeta,
  ChannelMessageToolHints,
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
  IChannelInboundAdapter,
  InboundProtocol,
} from '@modules/channels/types';
import type {
  RegisterFileInput,
  RegisterFileResult,
} from '@modules/services/file/types';
import { getLogger, Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';
import { SpanStatusCode } from '@opentelemetry/api';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { MultiAccountManager } from '@modules/channels/accounts';
import type { ResolvedAccount } from '@modules/channels/accounts';
// 2026-08-06（P0-2）：授权行为与 dmPolicy 一致的默认实现
import { DmPolicyEngine } from '../policy/DmPolicy';
// 2026-08-21（AC-2 治理）：统一发布 CHANNEL_CONNECTED / CHANNEL_DISCONNECTED /
// CHANNEL_STOPPED 生命周期事件到 ChannelEventBus（之前常量定义存在但无任何发布方）
import { ChannelEvents, channelEventBus } from '../events/ChannelEventBus';

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
 * - 标准 inbound 消息接收骨架（默认无接收能力，子类可覆写 createInboundAdapter 启用）
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

  /** 默认消息发送目标（群 ID / 用户 ID），子类可在 onConnect 中设置 */
  homeChannelId = '';

  // ─── Tracing ────────────────────────────────────────────
  /** 是否启用 OTel tracing（子类可在构造函数中设为 true） */
  protected _tracingEnabled = false;

  /**
   * 开启一个 tracing span
   * tracing 失败不影响主流程
   */
  protected _startTracing(
    name: string,
    attributes?: Record<string, unknown>
  ): unknown | null {
    if (!this._tracingEnabled) return null;
    try {
      const otel = getOTelTracing();
      const attrs: Record<string, string | number | boolean> = {
        'channel.id': String(this.id),
      };
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) {
          if (
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean'
          ) {
            attrs[k] = v;
          }
        }
      }
      const span = otel.startSpan(name, attrs);
      return span;
    } catch {
      // @ignore-catch — OTel span 创建失败返回 null（可观测性降级，不影响主流程）
      return null;
    }
  }

  /**
   * 结束 tracing span
   */
  protected _endTracing(span: unknown, error?: Error): void {
    if (!span) return;
    try {
      const otel = getOTelTracing();
      if (error) {
        otel.recordError(span as Parameters<typeof otel.recordError>[0], error);
        otel.endSpan(
          span as Parameters<typeof otel.endSpan>[0],
          SpanStatusCode.ERROR,
          error.message
        );
      } else {
        otel.endSpan(
          span as Parameters<typeof otel.endSpan>[0],
          SpanStatusCode.OK
        );
      }
    } catch {
      // tracing 失败不影响主流程
    }
  }

  // ─── 模型提示（渠道场景透传） ───────────────────────────
  private _modelHint = '';

  /**
   * 设置模型提示
   * 当渠道回复消息时，自动在消息尾部追加模型名称提示，
   * 帮助用户了解当前回复来自哪个 AI 模型。
   * @param hint 模型名称提示（如 "gpt-4o-mini"），空字符串表示不追加
   */
  setModelHint(hint: string): void {
    this._modelHint = hint;
  }

  /** 多账号管理器 — 子类可在构造函数中注册账号 */
  protected readonly multiAccount = new MultiAccountManager();

  /** 当前使用的账号 ID（onConnect 时设置） */
  protected currentAccountId = '';

  /**
   * 解析账号：按指定 ID 查找，未命中时 fallback 到默认账号
   * 子类可覆写此方法实现自定义账号解析逻辑
   */
  protected resolveAccount(accountId?: string | null): ResolvedAccount | null {
    return this.multiAccount.resolve(accountId);
  }

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
    this.logger = getLogger('channels:base');
  }

  // ─── AC-2 生命周期事件发布统一辅助器 ──────────────────────
  /**
   * 统一 publish CHANNEL_CONNECTED / CHANNEL_DISCONNECTED / CHANNEL_STOPPED。
   * payload 设计：
   *   - channelId / channelName：消费者可任选，对齐 QQChannel 的 CHANNEL_ERROR（含 channelName）
   *   - status / connected / uptimeMs：ChannelRealtimeMonitor 可直接读，不再需要轮询 registry
   *   - at：事件发生时间（单调时钟用 Date.now()）
   *   - cause：可选触发原因（disconnect/stop 的场景下便于区分主动/被动/错误）
   */
  private _publishLifecycleEvent(
    event:
      | typeof ChannelEvents.CHANNEL_CONNECTED
      | typeof ChannelEvents.CHANNEL_DISCONNECTED
      | typeof ChannelEvents.CHANNEL_STOPPED,
    cause?: string,
    extra: Record<string, unknown> = {}
  ): void {
    try {
      // CS03：EventBus publish 内部若出 bug 不影响连接主流程
      const status = this.lifecycle.getStatus();
      channelEventBus.publish(event, {
        channelId: this.id,
        channelName: this.id,
        connected: status.connected,
        uptimeMs: status.uptimeMs,
        at: Date.now(),
        cause,
        status,
        ...extra,
      });
    } catch (err) {
      void handleError(err, {
        module: 'channels:base',
        action: 'publish_lifecycle_event',
        context: { channel: this.id, event, cause },
        rethrow: false,
      });
    }
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

  /**
   * 获取通道消息工具提示
   * 子类可覆写此方法提供通道特有的 LLM 提示
   */
  getMessageToolHints(): ChannelMessageToolHints {
    return {};
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
      // P2-1：connect 幂等守卫 — 已连接时先断开再重连，
      // 避免 handleUpdateChannel/handleApplyChannelConfig 每次保存累积重复 WS 连接
      if (this._state.connected) {
        await this.onDisconnect();
      }
      this._state = {
        connected: false,
        lastMessageAt: null,
        startTime: Date.now(),
      };
      await this.onConnect(config);
      this._state = { ...this._state, connected: true };
      this.logger.info(`${this.id} 通道已连接`);
      // AC-2：onConnect 抛错会在上层 throw 中断流程（不会走到这），到这里 = 连接成功
      this._publishLifecycleEvent(
        ChannelEvents.CHANNEL_CONNECTED,
        'lifecycle_connect'
      );
    },

    disconnect: async () => {
      this._state = { ...this._state, connected: false };
      await this.onDisconnect();
      this.logger.info(`${this.id} 通道已断开`);
      // AC-2：disconnect 完成后统一发布 DISCONNECTED 事件
      // （主动断开/重连前的先断开/异常断开最终都会走到 lifecycle.disconnect 桥接入口）
      this._publishLifecycleEvent(
        ChannelEvents.CHANNEL_DISCONNECTED,
        'lifecycle_disconnect'
      );
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
      const finalContent = this._modelHint
        ? `${content}\n[模型: ${this._modelHint}]`
        : content;

      this.logger.info(`[TRACE] ${this.id} outbound.sendText 被调用`, {
        target,
        contentLength: finalContent.length,
        hasModelHint: !!this._modelHint,
      });

      const result = await this.sendTextMessage(target, finalContent);

      this.logger.info(`[TRACE] ${this.id} outbound.sendText 完成`, {
        target,
        success: result.success,
        error: result.error,
        messageId: result.messageId,
        latencyMs: Date.now() - start,
      });
      result.latencyMs = Date.now() - start;
      this._state = { ...this._state, lastMessageAt: Date.now() };
      return result;
    },

    sendMarkdown: async (target: string, content: string) => {
      const start = Date.now();
      const finalContent = this._modelHint
        ? `${content}\n\n**模型**: ${this._modelHint}`
        : content;
      if (this.meta.markdownCapable) {
        const result = await this.sendMarkdownMessage(target, finalContent);
        result.latencyMs = Date.now() - start;
        this._state = { ...this._state, lastMessageAt: Date.now() };
        return result;
      }
      const result = await this.sendTextMessage(target, finalContent);
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

    authorizeMessage: async (ctx: MessageContext) => {
      // 2026-08-06（P0-2）：默认授权行为与 dmPolicy 一致（委托 DmPolicyEngine），
      // 修复"默认 dmPolicy=pairing 但 authorizeMessage 恒放行"的自相矛盾。
      // 子类可通过覆写 security 保留自定义逻辑。
      const engine = new DmPolicyEngine({
        policy: this.security.dmPolicy,
        allowFrom: this.security.allowFrom ?? [],
        pairingCodeTimeoutMs: this.security.pairingCodeTimeoutMs,
        maxPairingAttempts: this.security.maxPairingAttempts,
      });
      return engine.authorize(ctx);
    },
  };

  // ─── 入站消息处理器 ─────────────────────────────────────
  private _messageHandler: ((message: MessageContext) => Promise<void>) | null =
    null;
  private _inboundListening = false;

  /** 子类访问入站监听状态 */
  protected get inboundListening(): boolean {
    return this._inboundListening;
  }

  /**
   * 设置入站消息回调
   * 子类在收到消息时调用此回调将消息传递给上层路由
   */
  protected setMessageHandler(
    handler: (message: MessageContext) => Promise<void>
  ): void {
    this._messageHandler = handler;
  }

  /**
   * 触发入站消息处理
   * 子类接收通道收到消息时调用此方法
   */
  protected async handleIncomingMessage(
    message: MessageContext
  ): Promise<void> {
    this._state = { ...this._state, lastMessageAt: Date.now() };

    this.logger.info(`[TRACE] ${this.id} 入站消息到达 handleIncomingMessage`, {
      id: this.id,
      messageId: message.messageId,
      senderId: message.senderId,
      conversationId: message.conversationId,
      hasHandler: !!this._messageHandler,
      contentPrefix:
        typeof message.content === 'string' ? message.content.slice(0, 50) : '',
    });

    if (this._messageHandler) {
      this.logger.info(`[TRACE] ${this.id} 调用 messageHandler 开始`, {
        messageId: message.messageId,
      });
      try {
        await this._messageHandler(message);
        this.logger.info(`[TRACE] ${this.id} messageHandler 执行完成`, {
          messageId: message.messageId,
        });
      } catch (error) {
        await handleError(error, {
          module: 'channels:base',
          action: 'handleIncomingMessage',
          context: { id: this.id, messageId: message.messageId },
        });
      }
    } else {
      this.logger.warning(
        `${this.id} 通道收到消息但 messageHandler 未注册，消息将被丢弃`,
        {
          id: this.id,
          messageId: message.messageId,
          senderId: message.senderId,
        }
      );
    }
  }

  /**
   * 设置入站监听状态（子类在 start/stop 中使用）
   */
  protected setInboundListening(listening: boolean): void {
    this._inboundListening = listening;
  }

  /**
   * handleInboundFile — 入站文件注册到 FileRegistry
   *
   * 渠道收到文件消息后调用此方法，将文件注册到 FileRegistry 统一管理。
   * 子类只需提供文件内容和元信息，无需关心存储路径、MD5 去重等细节。
   *
   * @param input 注册文件输入（原始文件名、内容、来源、MIME 类型等）
   * @returns 注册结果（包含 fileId、保存路径等信息）
   */
  protected async handleInboundFile(
    input: Omit<RegisterFileInput, 'source'> & {
      source?: RegisterFileInput['source'];
    }
  ): Promise<RegisterFileResult> {
    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    return registry.registerFile({
      content: input.content,
      originalName: input.originalName,
      source: input.source || `channel_${this.id}`,
      sourceId: input.sourceId,
      mimeType: input.mimeType,
      description: input.description,
    });
  }

  /**
   * 创建默认入站适配器（子类可覆写此方法提供自定义实现）
   */
  protected createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'none' as InboundProtocol,

      get isListening(): boolean {
        return self._inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.warn(`${self.id} 通道未实现入站消息接收`);
        self._inboundListening = false;
      },

      stop: async (): Promise<void> => {
        self._inboundListening = false;
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  // ─── IChannelInboundAdapter ─────────────────────────────
  private _inboundAdapter: IChannelInboundAdapter | null = null;

  get inbound(): IChannelInboundAdapter {
    if (!this._inboundAdapter) {
      const raw = this.createInboundAdapter();
      // 子类未实现入站（createInboundAdapter 返回空）→ 返回空对象占位？不行：
      // IChannelInboundAdapter 要求 readonly protocol / isListening / start / stop / ...
      // 但 IChannelPlugin 接口上 inbound?: IChannelInboundAdapter，所以这里允许 null。
      // TS 这里 getter 返回类型是 IChannelInboundAdapter（非 optional），
      // 和接口不一致 — 但旧代码就这么写，我们保持行为不变：
      // 当 raw 为空（无入站）时返回 raw，靠调用方 (IChannelPlugin 声明 inbound?) 来处理。
      if (!raw) {
        this._inboundAdapter = raw as unknown as IChannelInboundAdapter;
      } else {
        // AC-2：包装 inbound.stop()，在入站监听完全停止后发布 CHANNEL_STOPPED
        // （入站 stop = 插件不再接收消息，对应「生命周期终点」语义；
        //  lifecycle.disconnect 仅断网关连接，还可能被重连继续）
        const originalStop: () => Promise<void> = raw.stop.bind(raw);
        const self = this;
        const wrapped: IChannelInboundAdapter = {
          ...raw,
          stop: async () => {
            try {
              await originalStop();
            } finally {
              self._publishLifecycleEvent(
                ChannelEvents.CHANNEL_STOPPED,
                'inbound_stop'
              );
            }
          },
        };
        this._inboundAdapter = wrapped;
      }
    }
    return this._inboundAdapter;
  }

  // ─── IChannelPairingAdapter (可选) ──────────────────────
  pairing?: IChannelPairingAdapter;
}
