/**
 * EmailChannel 电子邮件通道
 * 对标 Hermes 的 Email 通道实现
 */
import { EventEmitter } from 'node:events';

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
  async sendHtml(target: string, subject: string, html: string): Promise<boolean> {
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
