/**
 * SMTP 邮件发送器
 * 基于 nodemailer，支持密码模式和 OAuth2 模式
 * 强制 TLS、频率限制、日志脱敏
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type { EmailSendArgs, EmailSendResult } from '@modules/mail/types';
import { EmailConfigService } from './EmailConfigService';
import type { EmailAccount } from '@modules/mail/types';

const logger = new Logger({
  module: 'mail:email',
  level: LogLevel.INFO,
});

/** 频率限制：每分钟最多 10 封 */
let sendCountThisMinute = 0;
let minuteWindow = Date.now();

/**
 * 邮件发送器
 * 动态加载 nodemailer 避免非 enterprise 构建的依赖问题
 */
export class EmailSender {
  private configService: EmailConfigService;

  constructor(configService: EmailConfigService) {
    this.configService = configService;
  }

  /**
   * 发送邮件
   */
  async send(args: EmailSendArgs): Promise<EmailSendResult> {
    this.checkRateLimit();

    // 日志脱敏：不记录正文和收件人
    logger.info('邮件发送', {
      to: '[REDACTED]',
      subject: args.subject,
      hasAttachments: !!(args.attachments?.length),
    });

    // 获取配置
    const accounts = this.configService.getAccounts();
    if (accounts.length === 0) {
      throw new Error('MAIL_AUTH_FAILED: 未配置邮箱账户，请先执行 mail:config');
    }

    const account = accounts[0]; // 使用第一个账户

    try {
      // 动态导入 nodemailer（仅在 enterprise 构建中可用）
      const nodemailer = await import('nodemailer');

      const transportConfig = this.buildTransportConfig(account);
      const transporter = nodemailer.default.createTransport(transportConfig);

      const mailResult = await transporter.sendMail({
        from: account.user,
        to: Array.isArray(args.to) ? args.to.join(', ') : args.to,
        subject: args.subject,
        text: args.body,
        attachments: args.attachments?.map((att) => ({
          path: att.path,
          filename: att.filename,
        })),
      });

      sendCountThisMinute++;
      return {
        messageId: mailResult.messageId,
        accepted: (mailResult.accepted as string[]) || [],
        rejected: (mailResult.rejected as string[]) || [],
      };
    } catch (error) {
      throw new Error(`MAIL_SEND_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
 * 构建 nodemailer 传输配置
 */
private buildTransportConfig(account: EmailAccount): Record<string, unknown> {
    if (account.authMethod === 'oauth2') {
      return {
        host: account.smtpHost,
        port: account.smtpPort || 587,
        secure: false, // STARTTLS
        auth: {
          type: 'OAuth2',
          user: account.user,
          clientId: account.clientId,
          clientSecret: account.clientSecret,
          refreshToken: account.refreshToken,
          accessToken: account.accessToken,
        },
        tls: { rejectUnauthorized: true },
      };
    }

    // 密码模式
    return {
      host: account.smtpHost,
      port: account.smtpPort || 587,
      secure: false,
      auth: {
        user: account.user,
        pass: account.pass,
      },
      tls: { rejectUnauthorized: true },
    };
  }

  /**
   * 频率限制检查
   */
  private checkRateLimit(): void {
    const now = Date.now();
    if (now - minuteWindow > 60000) {
      sendCountThisMinute = 0;
      minuteWindow = now;
    }
    if (sendCountThisMinute >= 10) {
      throw new Error('MAIL_SEND_FAILED: 每分钟最多发送 10 封邮件');
    }
  }
}
