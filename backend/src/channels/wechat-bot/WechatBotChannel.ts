/**
 * 个人微信 Bot 通道插件
 * 厂商: 微信个人号 (通过 WeChatFerry 桥接)
 * 协议: WeChatFerry HTTP API (默认 http://localhost:7600)
 * 特色: 支持出站消息发送 + 入站消息轮询
 *
 * 依赖: 需要运行 WeChatFerry 的 wcfhttp 服务
 *       (https://github.com/lich0821/WeChatFerry)
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
import { WcfClient, type WcfMessage } from './wcf-client';

/** 微信消息类型枚举（WeChatFerry 定义） */
const WCF_MSG_TYPE_TEXT = 1;
const WCF_MSG_TYPE_IMAGE = 3;
const WCF_MSG_TYPE_FILE = 6;

const WECHAT_BOT_META: ChannelMeta = {
  id: 'wechat-bot',
  displayName: '个人微信 Bot',
  vendor: '微信个人号 (WeChatFerry)',
  vendorSite: 'https://github.com/lich0821/WeChatFerry',
  icon: '💬',
  markdownCapable: false,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'file'],
};

const WECHAT_BOT_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

/** 默认消息轮询间隔（毫秒） */
const DEFAULT_POLL_INTERVAL_MS = 2000;

class WechatBotChannelPlugin extends BaseChannelPlugin {
  readonly id = 'wechat-bot';
  readonly meta = WECHAT_BOT_META;
  readonly capabilities = WECHAT_BOT_CAPABILITIES;

  private wcfClient: WcfClient;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

  constructor() {
    super();

    this.wcfClient = new WcfClient();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => {
        const wxid =
          (sender['wxid'] as string) || (sender['id'] as string) || 'unknown';
        const name = (sender['name'] as string) || wxid;
        return { userId: wxid, displayName: name, isApproved: true };
      },
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      httpUrl: 'http://localhost:7600',
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['httpUrl'])
      errors.push('缺少 httpUrl (WeChatFerry HTTP 服务地址)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    const httpUrl = (config['httpUrl'] as string) || 'http://localhost:7600';
    this.pollIntervalMs =
      (config['pollIntervalMs'] as number) || DEFAULT_POLL_INTERVAL_MS;

    this.wcfClient.updateConfig({ httpUrl });

    const loggedIn = await this.wcfClient.checkLogin();
    if (!loggedIn) {
      this.logger.warn(
        'WeChatFerry 服务未登录，请检查微信客户端是否已扫码登录'
      );
    }

    this.wcfClient.resetMessageCursor();
    this.logger.info('个人微信 Bot 通道已连接', { httpUrl });
  }

  protected override async onDisconnect(): Promise<void> {
    this.stopPolling();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    const ok = await this.wcfClient.sendText(target, content);
    return {
      success: ok,
      error: ok ? undefined : '发送文本消息失败',
    };
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    const ok = await this.wcfClient.sendImage(target, imageUrl);
    return {
      success: ok,
      error: ok ? undefined : '发送图片消息失败',
    };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    const ok = await this.wcfClient.sendFile(target, filePath);
    return {
      success: ok,
      error: ok ? undefined : '发送文件消息失败',
    };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const text = `【${card.title}】\n${card.content}`;
    return this.sendTextMessage(target, text);
  }

  // ────────────────────────────────────────────────────────────
  // 入站消息轮询接收（WeChatFerry 无 WebSocket 推送，只能轮询）
  // ────────────────────────────────────────────────────────────

  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'polling' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
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

  /**
   * 启动消息轮询
   */
  private startPolling(): void {
    if (this.pollTimer) return;

    this.setInboundListening(true);
    this.pollTimer = setInterval(async () => {
      await this.pollOnce();
    }, this.pollIntervalMs);

    this.logger.info('个人微信 Bot 消息轮询已启动', {
      intervalMs: this.pollIntervalMs,
    });
  }

  /**
   * 停止消息轮询
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.setInboundListening(false);
    this.logger.info('个人微信 Bot 消息轮询已停止');
  }

  /**
   * 单次轮询：拉取新消息并路由
   */
  private async pollOnce(): Promise<void> {
    try {
      const messages = await this.wcfClient.pollMessages();

      for (const msg of messages) {
        const ctx = this.toMessageContext(msg);
        if (ctx) {
          this.handleIncomingMessage(ctx).catch((error) => {
            this.logger.error('处理微信入站消息失败', {
              msgId: msg.id,
              error: String(error),
            });
          });
        }
      }
    } catch (error) {
      this.logger.error('微信消息轮询异常', { error: String(error) });
    }
  }

  /**
   * 将 WcfMessage 转换为标准 MessageContext
   */
  private toMessageContext(msg: WcfMessage): MessageContext | null {
    if (!msg.content) return null;

    let messageType: MessageContext['messageType'] = 'text';
    if (msg.type === WCF_MSG_TYPE_IMAGE) messageType = 'image';
    else if (msg.type === WCF_MSG_TYPE_FILE) messageType = 'file';

    return {
      channelId: 'wechat-bot',
      senderId: msg.wxid,
      senderName: msg.sender || msg.wxid,
      groupId: msg.isGroup ? msg.roomId : undefined,
      conversationId: msg.isGroup ? msg.roomId : msg.wxid,
      messageId: msg.id,
      messageType,
      content: msg.content,
      timestamp: msg.timestamp || Date.now(),
      isDirectMessage: !msg.isGroup,
      rawPayload: msg as unknown as Record<string, unknown>,
    };
  }
}

/**
 * 创建个人微信 Bot 通道插件实例
 */
function createWechatBotChannel(): IChannelPlugin {
  return new WechatBotChannelPlugin();
}

export const wechatBotChannel = createWechatBotChannel();
