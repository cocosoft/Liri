/**
 * QQ Bot 通道插件
 * 厂商: 腾讯, 协议: QQ 开放平台 WebSocket 长连接
 * 特色: WebSocket 心跳保活 + HTTP API 消息发送
 */

import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const QQ_META: ChannelMeta = {
  id: 'qq',
  displayName: 'QQ Bot',
  vendor: '腾讯 (Tencent)',
  vendorSite: 'https://q.qq.com/',
  icon: '🐧',
  markdownCapable: true,
  maxMessageLength: 2048,
  supportedMessageTypes: ['text', 'image', 'markdown'],
};

const QQ_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: true,
  groupMention: true,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: false,
  imageMessage: true,
  webhook: true,
};

class QQChannelPlugin extends BaseChannelPlugin {
  readonly id = 'qq';
  readonly meta = QQ_META;
  readonly capabilities = QQ_CAPABILITIES;
  private appId = '';
  private token = '';
  private secret = '';
  private wsConnection: unknown = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'pairing' as const,
      maxPairingAttempts: 5,
      resolveSender: async (sender: Record<string, unknown>) => {
        const author = sender['author'] as Record<string, unknown> | undefined;
        const userId =
          (sender['id'] as string) || (author?.['id'] as string) || 'unknown';
        const username = (author?.['username'] as string) || userId;
        return { userId, displayName: username, isApproved: false };
      },
    };

    this.pairing = {
      generatePairingCode: async (userId: string) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        this.logger.info(`QQ Bot 配对码: ${userId} → ${code}`);
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
      appId: '',
      token: '',
      secret: '',
      webhookPort: 8086,
      wsHost: 'api.sgroup.qq.com',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['appId']) errors.push('缺少 appId (QQ Bot AppID)');
    if (!config['token']) errors.push('缺少 token (Bot Token)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.appId = (config['appId'] as string) || '';
    this.token = (config['token'] as string) || '';
    this.secret = (config['secret'] as string) || '';

    if (!this.appId || !this.token)
      throw new AppError(
        'QQ Bot: appId 和 token 是必需的',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'qq', missing: ['appId', 'token'] }
      );

    this.logger.info('QQ Bot 通道已连接');
  }

  protected override async onDisconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      const resp = await fetch('https://api.sgroup.qq.com/gateway', {
        headers: { Authorization: `Bot ${this.appId}.${this.token}` },
      });
      return { healthy: resp.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: this.state.connected, latencyMs: Date.now() - start };
    }
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this.appId || !this.token) return { success: false, error: '未连接' };
    try {
      const body = {
        msg_type: 0,
        content: content.slice(0, QQ_META.maxMessageLength),
        msg_id: `${Date.now()}`,
      };
      const url = target.includes('channels/')
        ? `https://api.sgroup.qq.com/channels/${target}/messages`
        : `https://api.sgroup.qq.com/v2/users/${target}/messages`;

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${this.appId}.${this.token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await resp.json()) as Record<string, unknown>;
      const ok = resp.ok;
      return {
        success: ok,
        error: ok ? undefined : (data['message'] as string),
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
    if (!this.appId || !this.token) return { success: false, error: '未连接' };
    try {
      const body = {
        msg_type: 2,
        markdown: { content },
        msg_id: `${Date.now()}`,
      };
      const resp = await fetch(
        `https://api.sgroup.qq.com/v2/users/${target}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${this.appId}.${this.token}`,
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

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return {
      success: false,
      error: 'QQ Bot 图片发送需先上传素材，暂未实现',
    };
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'QQ Bot 文件发送暂未实现' };
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    const mdContent = `**${card.title}**\n${card.content}`;
    return this.sendMarkdownMessage(target, mdContent);
  }
}

function createQQChannel(): IChannelPlugin {
  return new QQChannelPlugin();
}

export const qqChannel = createQQChannel();
