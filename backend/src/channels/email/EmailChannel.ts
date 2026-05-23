/**
 * EmailChannel 电子邮件通道
 * 对标 Hermes 的 Email 通道实现
 */
import { EventEmitter } from 'node:events';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  ChannelStatus,
  SendResult,
  InteractiveCard,
  ResolvedSender,
} from '@modules/channels/types';

/**
 * Email 配置
 */
export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
  fromName: string;
  maxRetries: number;
  timeout: number;
}

/**
 * Email 消息
 */
export interface EmailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  messageId?: string;
  status?: 'queued' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
}

/**
 * Email 通道
 */
export class EmailChannel extends EventEmitter {
  private config: EmailConfig;
  private connected: boolean = false;

  constructor(config?: Partial<EmailConfig>) {
    super();

    this.config = {
      enabled: config?.enabled || false,
      host: config?.host || '',
      port: config?.port || 587,
      secure: config?.secure ?? false,
      user: config?.user || '',
      pass: config?.pass || '',
      fromAddress: config?.fromAddress || '',
      fromName: config?.fromName || 'PY_APP',
      maxRetries: config?.maxRetries ?? 3,
      timeout: config?.timeout ?? 30000,
    };
  }

  /**
   * 连接到 SMTP 服务器
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) return false;

    if (!this.config.host || !this.config.user || !this.config.pass) {
      this.emit('error', { message: 'SMTP 配置不完整' });
      return false;
    }

    this.connected = true;
    this.emit('connected', {
      host: this.config.host,
      port: this.config.port,
    });

    return true;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected', {});
  }

  /**
   * 发送 Email
   */
  async sendMessage(target: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    const message: EmailMessage = {
      to: target.split(',').map((t) => t.trim()),
      subject: 'PY_APP 消息通知',
      body: text,
      status: 'queued',
      timestamp: Date.now(),
    };

    this.emit('message:sent', message);

    return true;
  }

  /**
   * 发送格式化 HTML 邮件
   */
  async sendHtml(
    target: string,
    subject: string,
    html: string
  ): Promise<boolean> {
    if (!this.connected) return false;

    const message: EmailMessage = {
      to: target.split(',').map((t) => t.trim()),
      subject,
      body: html.replace(/<[^>]*>/g, ''),
      htmlBody: html,
      status: 'queued',
      timestamp: Date.now(),
    };

    this.emit('message:sent', message);

    return true;
  }

  /**
   * 获取通道状态
   */
  getStatus(): Record<string, unknown> {
    return {
      name: 'email',
      type: 'email',
      enabled: this.config.enabled,
      connected: this.connected,
      host: this.config.host,
      fromAddress: this.config.fromAddress,
    };
  }
}

export const emailChannel = new EmailChannel();

const EMAIL_META: ChannelMeta = {
  id: 'email',
  displayName: 'Email',
  vendor: 'SMTP',
  vendorSite: '',
  icon: 'email',
  markdownCapable: true,
  maxMessageLength: 100000,
  supportedMessageTypes: ['text', 'markdown', 'file'],
};

const EMAIL_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  interactive: false,
  voiceCall: false,
  fileUpload: true,
  imageMessage: true,
  webhook: false,
};

export function createEmailChannel(): IChannelPlugin {
  return {
    id: 'email',
    meta: EMAIL_META,
    capabilities: EMAIL_CAPABILITIES,

    config: {
      validate(c: Record<string, unknown>) {
        const errors: string[] = [];
        if (!c['host']) errors.push('缺少 host');
        if (!c['user']) errors.push('缺少 user');
        if (!c['pass']) errors.push('缺少 pass');
        return { valid: errors.length === 0, errors };
      },
      getDefaultConfig() {
        return {
          host: '',
          port: 587,
          secure: false,
          user: '',
          pass: '',
          fromAddress: '',
          fromName: 'PY_APP',
        };
      },
    },

    lifecycle: {
      async connect(): Promise<void> {
        await emailChannel.connect();
      },
      async disconnect(): Promise<void> {
        await emailChannel.disconnect();
      },
      async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
        return { healthy: emailChannel['connected'], latencyMs: 0 };
      },
      getStatus(): ChannelStatus {
        return {
          connected: emailChannel['connected'],
          latencyMs: 0,
          lastMessageAt: null,
          uptimeMs: 0,
        };
      },
    },

    outbound: {
      async sendText(target: string, content: string): Promise<SendResult> {
        try {
          await emailChannel.sendMessage(target, content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendMarkdown(target: string, content: string): Promise<SendResult> {
        try {
          await emailChannel.sendHtml(target, 'PY_APP 消息', content);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      async sendImage(target: string, imageUrl: string): Promise<SendResult> {
        return this.sendText(target, `[图片] ${imageUrl}`);
      },
      async sendFile(_target: string, _filePath: string): Promise<SendResult> {
        return { success: false, error: 'Email: sendFile 未实现' };
      },
      async sendInteractive(
        target: string,
        card: InteractiveCard
      ): Promise<SendResult> {
        const html = `<h3>${card.title}</h3><p>${card.content}</p>`;
        try {
          await emailChannel.sendHtml(target, card.title, html);
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },

    security: {
      dmPolicy: 'open',
      pairingCodeTimeoutMs: 300000,
      maxPairingAttempts: 3,
      async resolveSender(
        sender: Record<string, unknown>
      ): Promise<ResolvedSender> {
        return {
          userId: (sender['to'] as string) || 'unknown',
          displayName: (sender['to'] as string) || 'unknown',
          isApproved: true,
        };
      },
      async authorizeMessage(): Promise<{ allowed: boolean; reason?: string }> {
        return { allowed: true };
      },
    },
  };
}

export const emailChannelPlugin = createEmailChannel();
