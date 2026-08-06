/**
 * 个人微信 Bot 通道插件
 * 厂商: 腾讯, 协议: weixin-cli HTTP Bridge
 * 前置: npx -y @tencent-weixin/openclaw-weixin-cli@latest install
 * 启动: 扫码登录后，weixin-cli 在本地启动 HTTP 服务
 *
 * 入站流程:
 *   1. 启动/检查 weixin-cli HTTP 服务
 *   2. 轮询拉取新消息
 *   3. AI 处理后通过 HTTP 发送回复
 */

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
import { BaseChannelPlugin } from '@modules/channels/base';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { WeixinCliManager, type CliStatus } from './cli-manager';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels\wechat\WechatChannel',
  level: LogLevel.INFO,
});

const WECHAT_META: ChannelMeta = {
  id: 'wechat',
  displayName: '个人微信',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://github.com/',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image'],
};

const WECHAT_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: true,
  webhook: false,
};

export const WECHAT_DEFAULT_CONFIG = {
  botHttpUrl: 'http://localhost:7600',
};

/**
 * 个人微信 Bot 通道插件
 * 通过 weixin-cli HTTP Bridge 收发消息
 */
class WechatChannelPlugin extends BaseChannelPlugin {
  readonly id = 'wechat';
  readonly meta = WECHAT_META;
  readonly capabilities = WECHAT_CAPABILITIES;

  private botHttpUrl = 'http://localhost:7600';
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private pollingIntervalMs = 2000;

  /** 已处理的消息 ID 集合（去重） */
  private processedIds = new Set<string>();

  /** 上次轮询时的时间戳 */
  private lastPollTime = 0;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'allowlist' as const,
      resolveSender: async (sender: Record<string, unknown>) => {
        const userId =
          (sender['FromUserName'] as string) ||
          (sender['userId'] as string) ||
          'unknown';
        return { userId, displayName: userId, isApproved: false };
      },
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { ...WECHAT_DEFAULT_CONFIG };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['botHttpUrl']) {
      errors.push('缺少 botHttpUrl (weixin-cli HTTP 服务地址)');
    }
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.botHttpUrl =
      (config['botHttpUrl'] as string) ||
      (process.env['WECHAT_BOT_HTTP_URL'] as string) ||
      'http://localhost:7600';

    // 自动检测并启动 weixin-cli（默认插件管理）
    const cliManager = WeixinCliManager.getInstance();
    const cliReady = await cliManager.ensureReady();
    if (!cliReady) {
      this.logger.warn(
        `weixin-cli 自动启动失败 (${cliManager.getStatus().lastError})，将尝试直接连接...`
      );
    } else {
      this.logger.info('weixin-cli 已自动启动');
    }

    // 检测 weixin-cli 服务是否可达
    const alive = await this.checkBotAlive();
    if (!alive) {
      this.logger.warn(
        `weixin-cli 服务未就绪 (${this.botHttpUrl})，请扫码登录...`
      );
    } else {
      this.logger.info('weixin-cli 服务已就绪');
    }

    // 启动入站消息轮询
    this.startPolling();

    this.logger.info('个人微信通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.stopPolling();
    this.processedIds.clear();

    // 停止 weixin-cli 进程
    const cliManager = WeixinCliManager.getInstance();
    await cliManager.stop();

    this.logger.info('个人微信通道已断开');
  }

  /** 获取 weixin-cli 状态（供 API 端点查询） */
  static getCliStatus(): CliStatus {
    return WeixinCliManager.getInstance().getStatus();
  }

  // ─── 出站：发送文本 ────────────────────────────────────

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      const resp = await fetch(`${this.botHttpUrl}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          content: content.slice(0, WECHAT_META.maxMessageLength),
          msgType: 'text',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await resp.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        success: resp.ok,
        error: resp.ok ? undefined : (data['error'] as string),
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:wechat',
        action: 'sendTextMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    try {
      const resp = await fetch(`${this.botHttpUrl}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, imageUrl, msgType: 'image' }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await resp.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        success: resp.ok,
        error: resp.ok ? undefined : (data['error'] as string),
      };
    } catch (err) {
      await handleError(err, {
        module: 'channels:wechat',
        action: 'sendImageMessage',
        context: { target },
      });
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return this.sendImageMessage(target, filePath);
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const text = `${card.title}\n${card.content}`;
    return this.sendTextMessage(target, text);
  }

  // ─── 健康检查 ──────────────────────────────────────────

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    const alive = await this.checkBotAlive();
    return { healthy: alive, latencyMs: Date.now() - start };
  }

  // ─── 入站：轮询拉取消息 ─────────────────────────────────

  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'polling' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening && self.pollingTimer !== null;
      },

      start: async (): Promise<void> => {
        self.startPolling();
      },

      stop: async (): Promise<void> => {
        self.stopPolling();
      },

      setMessageHandler: (
        handler: (message: MessageContext) => Promise<void>
      ): void => {
        self.setMessageHandler(handler);
      },
    };
  }

  // ─── 内部方法 ──────────────────────────────────────────

  /** 检测 weixin-cli 服务是否存活 */
  private async checkBotAlive(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.botHttpUrl}/api/status`, {
        signal: AbortSignal.timeout(5_000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** 启动消息轮询 */
  private startPolling(): void {
    if (this.pollingTimer) return;
    this.lastPollTime = Date.now();

    this.pollingTimer = setInterval(async () => {
      try {
        await this.pollMessages();
      } catch (error) {
        // 静默吞错，下一轮重试
        this.logger.debug('微信轮询失败', { error: String(error) });
      }
    }, this.pollingIntervalMs);

    this.setInboundListening(true);
    this.logger.info(`微信消息轮询已启动 (${this.pollingIntervalMs}ms)`);
  }

  /** 停止消息轮询 */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.setInboundListening(false);
  }

  /** 轮询拉取新消息 */
  private async pollMessages(): Promise<void> {
    const resp = await fetch(`${this.botHttpUrl}/api/messages`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      // 服务可能在重启/未扫码，静默等待
      return;
    }

    const data = (await resp.json().catch(() => [])) as WechatBotMessage[];
    if (!Array.isArray(data) || data.length === 0) return;

    for (const msg of data) {
      if (!msg.id || this.processedIds.has(msg.id)) continue;
      this.processedIds.add(msg.id);

      // 清理过期的去重 ID
      if (this.processedIds.size > 500) {
        const toDelete = [...this.processedIds].slice(0, 200);
        for (const id of toDelete) this.processedIds.delete(id);
      }

      const context: MessageContext = {
        channelId: 'wechat',
        senderId: msg.senderId || msg.from || 'unknown',
        senderName: msg.senderName || msg.from || 'unknown',
        conversationId:
          msg.senderId || msg.from || msg.conversationId || 'unknown',
        messageId: msg.id,
        messageType: msg.type === 'image' ? 'image' : 'text',
        content: msg.content || '',
        timestamp: msg.timestamp || Date.now(),
        isDirectMessage: true,
        rawPayload: msg as unknown as Record<string, unknown>,
      };

      await this.handleIncomingMessage(context);
    }
  }
}

/** weixin-cli HTTP API 返回的消息结构 */
interface WechatBotMessage {
  id: string;
  from?: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  type?: string;
  timestamp?: number;
  conversationId?: string;
}

// ─── 工厂函数 ────────────────────────────────────────────

export function createWechatChannel(): IChannelPlugin {
  return new WechatChannelPlugin();
}

export const wechatChannel = createWechatChannel();
// P1-3 单例统一：Plugin 导出为同一实例别名，避免双实例
export const wechatChannelPlugin = wechatChannel;

// 保持旧版导出兼容
export function parseWechatXML(_xml: string): Record<string, string> {
  return {};
}
export function buildWechatReply(
  _to: string,
  _from: string,
  _content: string
): string {
  return '';
}
export class WechatCrypto {
  constructor(_key: string) {}
  verifySignature(): boolean {
    return true;
  }
  decryptMsg(e: string): string {
    return e;
  }
  encryptMsg(m: string): string {
    return m;
  }
}
