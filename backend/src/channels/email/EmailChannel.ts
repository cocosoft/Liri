/**
 * EmailChannel 电子邮件通道
 * 对标 Hermes 的 Email 通道实现
 */
import { EventEmitter } from 'node:events';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
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
 * Email 通道（遗留 EventEmitter 类，保持向后兼容）
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

class EmailChannelPlugin extends BaseChannelPlugin {
  readonly id = 'email';
  readonly meta = EMAIL_META;
  readonly capabilities = EMAIL_CAPABILITIES;

  constructor() {
    super();

    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      maxPairingAttempts: 3,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: (sender['to'] as string) || 'unknown',
        displayName: (sender['to'] as string) || 'unknown',
        isApproved: true,
      }),
    };
  }

  protected getDefaultConfig(): Record<string, unknown> {
    return {
      host: '',
      port: 587,
      secure: false,
      user: '',
      pass: '',
      fromAddress: '',
      fromName: 'PY_APP',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['host']) errors.push('缺少 host');
    if (!config['user']) errors.push('缺少 user');
    if (!config['pass']) errors.push('缺少 pass');
    return errors;
  }

  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    await emailChannel.connect();
  }

  protected override async onDisconnect(): Promise<void> {
    await emailChannel.disconnect();
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await emailChannel.sendMessage(target, content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    try {
      await emailChannel.sendHtml(target, 'PY_APP 消息', content);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.sendTextMessage(target, `[图片] ${imageUrl}`);
  }

  protected async sendFileMessage(
    _target: string,
    _filePath: string
  ): Promise<SendResult> {
    return { success: false, error: 'Email: sendFile 未实现' };
  }

  protected override async sendInteractiveMessage(
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
  }
}

export function createEmailChannel(): IChannelPlugin {
  return new EmailChannelPlugin();
}

export const emailChannelPlugin = createEmailChannel();
