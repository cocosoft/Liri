/**
 * EmailChannel 电子邮件通道
 * 对标 Hermes 的 Email 通道实现
 *
 * 使用 Node.js 内置 net/tls 模块实现 SMTP 协议，无需第三方库。
 * 支持：EHLO、AUTH LOGIN、STARTTLS、MIME 附件（base64）、HTML 邮件。
 */
import { EventEmitter } from 'events';
import { Socket } from 'net';
import { connect as tlsConnect, TLSSocket } from 'tls';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { randomUUID } from 'crypto';
import { BaseChannelPlugin } from '@modules/channels/base';
import type {
  IChannelPlugin,
  ChannelMeta,
  ChannelCapabilities,
  SendResult,
  InteractiveCard,
} from '@modules/channels/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { setEmailRuntime, clearEmailRuntime } from './runtime';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:email:EmailChannel',
  level: LogLevel.INFO,
});

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

/** SMTP 附件描述 */
interface SmtpAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** 生成 MIME boundary */
function makeBoundary(): string {
  return `--pyapp.boundary.${randomUUID().replace(/-/g, '')}`;
}

/** Base64 编码并按 RFC 2045 要求每 76 字符换行 */
function base64Chunked(data: Buffer): string {
  const base64 = data.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 76) {
    lines.push(base64.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

/**
 * SmtpClient — 基于 node:net/node:tls 的简易 SMTP 客户端
 *
 * 支持：
 * - 明文连接 + STARTTLS 升级
 * - 直接 TLS 连接（secure: true）
 * - AUTH LOGIN 认证
 * - MIME 多部分消息（附件 base64 编码）
 * - HTML 邮件
 */
class SmtpClient {
  private socket: Socket | TLSSocket | null = null;
  private buffer = '';
  private _timeout: number;
  private _host = '';
  private _port = 0;
  private _secure = false;
  private _user = '';
  private _pass = '';
  private _fromAddress = '';
  private _fromName = '';
  private _connected = false;

  constructor(config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromAddress: string;
    fromName: string;
    timeout: number;
  }) {
    this._host = config.host;
    this._port = config.port;
    this._secure = config.secure;
    this._user = config.user;
    this._pass = config.pass;
    this._fromAddress = config.fromAddress;
    this._fromName = config.fromName;
    this._timeout = config.timeout;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * 建立 SMTP 连接并完成认证
   */
  async connect(): Promise<void> {
    const socket = new Socket();
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error(`SMTP 连接超时 (${this._timeout}ms)`));
      }, this._timeout);

      socket.connect(this._port, this._host, () => {
        /* 连接建立后等待 220 欢迎消息 */
      });

      socket.setEncoding('utf-8');

      let handshakeDone = false;

      socket.on('data', async (data: string) => {
        this.buffer += data;

        if (!this.buffer.includes('\r\n')) return;

        if (!handshakeDone) {
          handshakeDone = true;
          clearTimeout(timeout);

          try {
            const greeting = this.readResponseLine();
            if (!greeting.startsWith('220')) {
              throw new Error(`SMTP 连接被拒: ${greeting}`);
            }

            await this.sendCommand(`EHLO ${this._host}`, 250);

            if (!this._secure) {
              const starttls = await this.tryStartTls(socket);
              if (!starttls) {
                await this.authenticate();
              }
            } else {
              await this.authenticate();
            }

            this._connected = true;
            resolve();
          } catch (err) {
            this.close();
            reject(err);
          }
        } else {
          /* 后续数据由 readResponse 处理 */
        }
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timeout);
        this.close();
        reject(err);
      });

      socket.on('close', () => {
        this._connected = false;
      });
    });
  }

  /**
   * 尝试 STARTTLS 升级
   */
  private async tryStartTls(socket: Socket): Promise<boolean> {
    try {
      await this.sendCommand('STARTTLS', 220);
    } catch {
      return false;
    }

    /* 升级到 TLS */
    const tlsSocket = tlsConnect({
      socket,
      host: this._host,
      rejectUnauthorized: false,
    });

    this.socket = tlsSocket;
    this.buffer = '';

    return new Promise<void>((resolve, reject) => {
      tlsSocket.once('secureConnect', async () => {
        try {
          /* EHLO again after STARTTLS */
          await this.sendCommand(`EHLO ${this._host}`, 250);
          await this.authenticate();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      tlsSocket.once('error', (err: Error) => {
        reject(err);
      });
    }).then(() => true);
  }

  /**
   * AUTH LOGIN 认证
   */
  private async authenticate(): Promise<void> {
    const userB64 = Buffer.from(this._user, 'utf-8').toString('base64');
    const passB64 = Buffer.from(this._pass, 'utf-8').toString('base64');

    await this.sendCommand('AUTH LOGIN', 334);
    await this.sendCommand(userB64, 334);
    await this.sendCommand(passB64, 235);
  }

  /**
   * 发送邮件
   *
   * @returns SMTP 响应的 message-id（如果有）
   */
  async sendMail(params: {
    to: string[];
    subject: string;
    body: string;
    htmlBody?: string;
    attachments?: SmtpAttachment[];
  }): Promise<string | undefined> {
    if (!this._connected || !this.socket) {
      throw new Error('SMTP 未连接');
    }

    const { to, subject, body, htmlBody, attachments } = params;

    /* MAIL FROM */
    await this.sendCommand(`MAIL FROM:<${this._fromAddress}>`, 250);

    /* RCPT TO */
    for (const recipient of to) {
      await this.sendCommand(`RCPT TO:<${recipient.trim()}>`, 250);
    }

    /* DATA */
    await this.sendCommand('DATA', 354);

    /* 构建 MIME 消息 */
    const message = this.buildMimeMessage({
      to,
      subject,
      body,
      htmlBody,
      attachments,
    });

    await this.writeRaw(message + '\r\n.\r\n');

    const response = await this.readResponse();
    if (!response.startsWith('250')) {
      throw new Error(`SMTP 发送失败: ${response}`);
    }

    /* 尝试提取 message-id */
    const idMatch = response.match(/<([^>]+)>/);
    return idMatch ? idMatch[1] : undefined;
  }

  /**
   * 构建符合 RFC 2822 的 MIME 消息
   */
  private buildMimeMessage(params: {
    to: string[];
    subject: string;
    body: string;
    htmlBody?: string;
    attachments?: SmtpAttachment[];
  }): string {
    const { to, subject, body, htmlBody, attachments } = params;
    const boundary = makeBoundary();
    const hasAttachments = attachments && attachments.length > 0;

    const from = this._fromName
      ? `=?UTF-8?B?${Buffer.from(this._fromName, 'utf-8').toString('base64')}?= <${this._fromAddress}>`
      : `<${this._fromAddress}>`;

    const lines: string[] = [
      `From: ${from}`,
      `To: ${to.join(', ')}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Date: ${new Date().toUTCString()}`,
      `X-Mailer: Liri Email Channel`,
    ];

    if (hasAttachments) {
      lines.push(
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`
      );
    }

    /* 正文部分 */
    if (htmlBody && hasAttachments) {
      lines.push(
        'Content-Type: multipart/alternative; boundary="alt' + boundary + '"',
        '',
        `--alt${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        body,
        '',
        `--alt${boundary}`,
        'Content-Type: text/html; charset="utf-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlBody,
        '',
        `--alt${boundary}--`
      );
    } else if (htmlBody) {
      lines.push(
        'Content-Type: multipart/alternative; boundary="alt' + boundary + '"',
        '',
        `--alt${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        body,
        '',
        `--alt${boundary}`,
        'Content-Type: text/html; charset="utf-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        htmlBody,
        '',
        `--alt${boundary}--`
      );
    } else {
      lines.push(
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        body
      );
    }

    if (hasAttachments) {
      for (const att of attachments!) {
        lines.push(
          '',
          `--${boundary}`,
          `Content-Type: ${att.contentType}; name="${att.filename}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${att.filename}"`,
          '',
          base64Chunked(att.content)
        );
      }
      lines.push('', `--${boundary}--`);
    }

    return lines.join('\r\n');
  }

  /**
   * 发送 QUIT 并关闭连接
   */
  async quit(): Promise<void> {
    try {
      await this.sendCommand('QUIT', 221);
    } catch (err) {
      // 忽略 QUIT 错误

      logger.debug('Operation skipped', {
        context: '忽略 QUIT 错误',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.close();
  }

  /** 关闭 socket */
  private close(): void {
    this._connected = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (err) {
        // 忽略

        logger.debug('Operation skipped', {
          context: '忽略',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.socket = null;
    }
    this.buffer = '';
  }

  /** 发送 SMTP 命令并等待预期响应码 */
  private async sendCommand(
    command: string,
    expectedCode: number
  ): Promise<string> {
    await this.writeRaw(command + '\r\n');
    const response = await this.readResponse();
    const code = parseInt(response.slice(0, 3), 10);
    if (code !== expectedCode) {
      throw new Error(
        `SMTP 错误 [期望 ${expectedCode}, 收到 ${code}]: ${response}`
      );
    }
    return response;
  }

  /** 写入原始数据到 socket */
  private writeRaw(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        return reject(new Error('SMTP socket 未连接'));
      }
      this.socket.write(data, 'utf-8', (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 从缓冲区读取一行响应 */
  private readResponseLine(): string {
    const idx = this.buffer.indexOf('\r\n');
    if (idx === -1) return '';
    const line = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + 2);
    return line;
  }

  /** 读取 SMTP 完整响应（处理多行连续响应） */
  private readResponse(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const waitForData = (): void => {
        const fullResponse: string[] = [];

        while (this.buffer.length > 0) {
          const line = this.readResponseLine();
          if (!line) break;

          fullResponse.push(line);

          /* 多行响应最后一行格式为 "NNN text"（第四位是空格而非连字符） */
          if (line.length >= 4 && line[3] === ' ') {
            this.buffer = '';
            resolve(fullResponse.join('\r\n'));
            return;
          }
        }

        /* 缓冲区数据不够，等待更多数据 */
        if (this.socket) {
          const onData = (data: string) => {
            this.buffer += data;
            this.socket?.removeListener('data', onData);
            waitForData();
          };
          this.socket.on('data', onData);

          /* 超时保护 */
          setTimeout(() => {
            this.socket?.removeListener('data', onData);
            reject(new Error('SMTP 读取响应超时'));
          }, this._timeout);
        } else {
          reject(new Error('SMTP socket 已关闭'));
        }
      };

      waitForData();
    });
  }
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
      fromName: config?.fromName || 'Liri',
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
      subject: 'Liri 消息通知',
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

  private smtpClient: SmtpClient | null = null;
  private smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromAddress: string;
    fromName: string;
    timeout: number;
  } | null = null;
  private _connected = false;

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
      fromName: 'Liri',
    };
  }

  protected validateConfig(config: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!config['host']) errors.push('缺少 host (SMTP 服务器地址)');
    if (!config['user']) errors.push('缺少 user (SMTP 用户名)');
    if (!config['pass']) errors.push('缺少 pass (SMTP 密码)');
    if (!config['fromAddress']) errors.push('缺少 fromAddress (发件人邮箱)');
    return errors;
  }

  protected async onConnect(config: Record<string, unknown>): Promise<void> {
    this.smtpConfig = {
      host: (config['host'] as string) || '',
      port: (config['port'] as number) || 587,
      secure: (config['secure'] as boolean) || false,
      user: (config['user'] as string) || '',
      pass: (config['pass'] as string) || '',
      fromAddress: (config['fromAddress'] as string) || '',
      fromName: (config['fromName'] as string) || 'Liri',
      timeout: (config['timeout'] as number) || 30000,
    };

    if (
      !this.smtpConfig.host ||
      !this.smtpConfig.user ||
      !this.smtpConfig.pass
    ) {
      throw new AppError(
        'Email: SMTP 配置不完整',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { channel: 'email', missing: ['host', 'user', 'pass'] }
      );
    }

    this.smtpClient = new SmtpClient(this.smtpConfig);

    try {
      await this.smtpClient.connect();
      this._connected = true;
      setEmailRuntime({ status: 'active', startedAt: Date.now() });
      this.logger.info('邮件通道已连接（SMTP）');

      await emailChannel.connect();
    } catch (err) {
      this._connected = false;
      this.smtpClient = null;
      throw new AppError(
        `Email: SMTP 连接失败 — ${(err as Error).message}`,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'CONNECTION_FAILED',
        { channel: 'email', host: this.smtpConfig.host }
      );
    }
  }

  protected override async onDisconnect(): Promise<void> {
    if (this.smtpClient) {
      try {
        await this.smtpClient.quit();
      } catch (err) {
        // 忽略

        logger.debug('Operation skipped', {
          context: '忽略',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.smtpClient = null;
    }
    this._connected = false;
    clearEmailRuntime();
    await emailChannel.disconnect();
  }

  protected override async checkHealth(): Promise<{
    healthy: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    return { healthy: this._connected, latencyMs: Date.now() - start };
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this._connected || !this.smtpClient) {
      return { success: false, error: 'SMTP 未连接' };
    }

    try {
      const recipients = target
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        return { success: false, error: '收件人地址为空' };
      }

      const messageId = await this.smtpClient.sendMail({
        to: recipients,
        subject: 'Liri 消息通知',
        body: content,
      });

      return { success: true, messageId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    if (!this._connected || !this.smtpClient) {
      return { success: false, error: 'SMTP 未连接' };
    }

    try {
      const recipients = target
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        return { success: false, error: '收件人地址为空' };
      }

      /* 将 Markdown 转为简单 HTML */
      const htmlBody = mdToSimpleHtml(content);

      const messageId = await this.smtpClient.sendMail({
        to: recipients,
        subject: 'Liri 消息',
        body: content,
        htmlBody,
      });

      return { success: true, messageId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    if (!this._connected || !this.smtpClient) {
      return { success: false, error: 'SMTP 未连接' };
    }

    try {
      const recipients = target
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        return { success: false, error: '收件人地址为空' };
      }

      let imageBuffer: Buffer;
      let contentType = 'image/png';
      let filename = 'image.png';

      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        const resp = await fetch(imageUrl);
        if (!resp.ok) {
          return { success: false, error: `下载图片失败: ${resp.status}` };
        }
        const arrayBuffer = await resp.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);

        const ext = imageUrl.split('.').pop()?.toLowerCase() || 'png';
        filename = `image.${ext}`;
        contentType = mimeTypeForExt(ext);
      } else {
        /* 本地文件 */
        imageBuffer = readFileSync(imageUrl);
        const ext = basename(imageUrl).split('.').pop()?.toLowerCase() || 'png';
        filename = basename(imageUrl);
        contentType = mimeTypeForExt(ext);
      }

      const messageId = await this.smtpClient.sendMail({
        to: recipients,
        subject: 'Liri 图片消息',
        body: `[图片] ${imageUrl}`,
        attachments: [{ filename, content: imageBuffer, contentType }],
      });

      return { success: true, messageId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    if (!this._connected || !this.smtpClient) {
      return { success: false, error: 'SMTP 未连接' };
    }

    try {
      const recipients = target
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        return { success: false, error: '收件人地址为空' };
      }

      let fileBuffer: Buffer;
      let filename: string;
      let contentType: string;

      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        const resp = await fetch(filePath);
        if (!resp.ok) {
          return { success: false, error: `下载文件失败: ${resp.status}` };
        }
        const arrayBuffer = await resp.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        filename = basename(filePath) || 'file.bin';
        const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
        contentType = mimeTypeForExt(ext);
      } else {
        fileBuffer = readFileSync(filePath);
        filename = basename(filePath);
        const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
        contentType = mimeTypeForExt(ext);
      }

      const messageId = await this.smtpClient.sendMail({
        to: recipients,
        subject: 'Liri 文件消息',
        body: `附件: ${filename}`,
        attachments: [{ filename, content: fileBuffer, contentType }],
      });

      return { success: true, messageId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    if (!this._connected || !this.smtpClient) {
      return { success: false, error: 'SMTP 未连接' };
    }

    try {
      const recipients = target
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        return { success: false, error: '收件人地址为空' };
      }

      let buttonsHtml = '';
      if (card.buttons && card.buttons.length > 0) {
        buttonsHtml = card.buttons
          .map(
            (b) =>
              `<p style="margin:4px 0"><a href="${escapeHtml(b.value)}" style="display:inline-block;padding:8px 16px;background:#5865f2;color:#fff;text-decoration:none;border-radius:4px">${escapeHtml(b.text)}</a></p>`
          )
          .join('\n');
      }

      const htmlBody = `<div style="font-family:sans-serif;max-width:600px"><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.content)}</p>${buttonsHtml}</div>`;

      const messageId = await this.smtpClient.sendMail({
        to: recipients,
        subject: card.title,
        body: `${card.title}\n\n${card.content}`,
        htmlBody,
      });

      return { success: true, messageId };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

/**
 * 将 Markdown 文本转为简单 HTML（内联样式，适合邮件）
 */
function mdToSimpleHtml(md: string): string {
  let html = escapeHtml(md);

  /* 代码块 */
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre style="background:#f5f5f5;padding:8px;border-radius:4px;overflow-x:auto"><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  /* 行内代码 */
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:#f5f5f5;padding:2px 4px;border-radius:3px">$1</code>'
  );

  /* 加粗 */
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  /* 斜体 */
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  /* 链接 */
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  /* 换行 */
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  return `<div style="font-family:sans-serif;max-width:600px"><p>${html}</p></div>`;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 根据文件扩展名返回 MIME 类型
 */
function mimeTypeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
  };
  return map[ext] || 'application/octet-stream';
}

export function createEmailChannel(): IChannelPlugin {
  return new EmailChannelPlugin();
}

export const emailChannelPlugin = createEmailChannel();
