/**
 * 飞书通道插件
 * 厂商: 字节跳动, SDK: @larksuiteoapi/node-sdk
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

const FEISHU_META: ChannelMeta = {
  id: 'feishu',
  displayName: '飞书',
  vendor: '字节跳动 (ByteDance)',
  vendorSite: 'https://open.feishu.cn/',
  icon: '🐦',
  markdownCapable: false,
  maxMessageLength: 30000,
  supportedMessageTypes: ['text', 'image', 'file', 'card'],
};

const FEISHU_CAPABILITIES: ChannelCapabilities = {
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

class FeishuChannelPlugin extends BaseChannelPlugin {
  readonly id = 'feishu';
  readonly meta = FEISHU_META;
  readonly capabilities = FEISHU_CAPABILITIES;
  private appId = '';
  private appSecret = '';
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'pairing' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const userId =
          (sender['open_id'] as string) ||
          (sender['sender_id'] as string) ||
          'unknown';
        return {
          userId,
          displayName: (sender['sender_name'] as string) || userId,
          isApproved: false,
        };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`飞书配对码: ${userId} → ${code}`);
        return code;
      },
      validatePairingCode: async (_userId: string, code: string) =>
        code.length === 6,
      listApprovedUsers: async () => [],
      removeApprovedUser: async (_userId: string) => {},
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return { appId: '', appSecret: '', verifyToken: '', webhookPort: 8083 };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId');
    if (!config['appSecret']) errors.push('缺少 appSecret');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appId = (config['appId'] as string) || '';
    this.appSecret = (config['appSecret'] as string) || '';
    if (!this.appId || !this.appSecret)
      throw new AppError(
        'Feishu: appId 和 appSecret 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'feishu', missing: ['appId', 'appSecret'] }
      );

    const resp = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      }
    );
    const data = (await resp.json()) as Record<string, unknown>;
    if ((data['code'] as number) !== 0) {
      throw new AppError(
        `Feishu: ${data['msg'] || '获取 tenant_access_token 失败'}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'API_ERROR',
        { channel: 'feishu', code: data['code'], msg: data['msg'] }
      );
    }
    this.tenantAccessToken = data['tenant_access_token'] as string;
    this.tokenExpiresAt =
      Date.now() + ((data['expire'] as number) || 7200) * 1000;
    this.logger.info('飞书通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    this.tenantAccessToken = null;
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    if (!this.tenantAccessToken) return { healthy: false, latencyMs: 0 };
    try {
      const resp = await fetch(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_id: this.appId,
            app_secret: this.appSecret,
          }),
        }
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
    if (!this.tenantAccessToken) return { success: false, error: '未连接' };
    try {
      const body = {
        receive_id: target,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      };
      const resp = await fetch(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tenantAccessToken}`,
          },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = (data['code'] as number) === 0;
      return {
        success: ok,
        error: ok ? undefined : (data['msg'] as string),
        messageId: data['data']
          ? ((data['data'] as Record<string, unknown>)['message_id'] as string)
          : undefined,
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
    return { success: false, error: '飞书图片发送需先上传素材，暂未实现' };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return { success: false, error: '飞书文件发送需先上传素材，暂未实现' };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    if (!this.tenantAccessToken) return { success: false, error: '未连接' };
    try {
      const feishuCard: Record<string, unknown> = {
        header: { title: { tag: 'plain_text', content: card.title } },
        elements: [
          {
            tag: 'div',
            text: { tag: 'plain_text', content: card.content },
          },
        ],
      };
      if (card.buttons) {
        const actions = card.buttons.map(
          (b: { text: string; value: string; style?: string }) => ({
            tag: 'button',
            text: { tag: 'plain_text', content: b.text },
            value: { key: 'action', value: b.value },
            type: b.style === 'danger' ? 'danger' : 'primary',
          })
        );
        (feishuCard.elements as unknown[]).push({ tag: 'action', actions });
      }
      const body = {
        receive_id: target,
        msg_type: 'interactive',
        content: JSON.stringify(feishuCard),
      };
      const resp = await fetch(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tenantAccessToken}`,
          },
          body: JSON.stringify(body),
        }
      );
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: (data['code'] as number) === 0,
        error: data['msg'] as string,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 创建入站适配器（Webhook 协议，尚未实现）
   * TODO: 启动 HTTP Server 接收飞书事件回调
   */
  protected override createInboundAdapter(): IChannelInboundAdapter {
    const self = this;
    return {
      protocol: 'webhook' as InboundProtocol,

      get isListening(): boolean {
        return self.inboundListening;
      },

      start: async (_config: Record<string, unknown>): Promise<void> => {
        self.logger.warn(
          '飞书入站消息接收未实现（需启动 HTTP Server 接收飞书事件回调）'
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

function createFeishuChannel(): IChannelPlugin {
  return new FeishuChannelPlugin();
}

export const feishuChannel = createFeishuChannel();
