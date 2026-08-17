/**
 * SMTP 邮件发送器
 * 基于 nodemailer，支持密码模式和 OAuth2 模式
 * 强制 TLS、频率限制、日志脱敏
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type { EmailSendArgs, EmailSendResult } from '@modules/mail/types';
import { EmailConfigService } from './EmailConfigService';
import type { EmailAccount } from '@modules/mail/types';
import { resolvePlainPassword } from './crypto';
import { resolveAttachmentsDir } from '@modules/core';

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
      hasAttachments: !!args.attachments?.length,
    });

    // 获取配置
    const accounts = this.configService.getAccounts();
    if (accounts.length === 0) {
      throw new Error('MAIL_AUTH_FAILED: 未配置邮箱账户，请先执行 mail:config');
    }

    const account = accounts[0]; // 使用第一个账户

    // D-2 安全：附件路径白名单——只允许 ~/.pyapp/attachments/ 内的文件，防止任意文件外发
    const attachments = await this.validateAndResolveAttachments(
      args.attachments
    );

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
        attachments: attachments.map((att) => ({
          path: att.path,
          filename: att.filename,
        })),
      });

      return {
        messageId: mailResult.messageId,
        accepted: (mailResult.accepted as string[]) || [],
        rejected: (mailResult.rejected as string[]) || [],
      };
    } catch (error) {
      // G-17：发送失败释放占位配额（checkRateLimit 已同步占位递增）
      if (sendCountThisMinute > 0) sendCountThisMinute--;
      throw new Error(
        `MAIL_SEND_FAILED: ${error instanceof Error ? error.message : String(error)}`
      );
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
        // BUG-2：存储的是密文，认证前必须解密为明文
        pass: resolvePlainPassword(account.pass),
      },
      tls: { rejectUnauthorized: true },
    };
  }

  /**
   * D-2 附件安全校验：仅允许 ~/.pyapp/attachments/ 目录内的文件
   * 拒绝任意绝对路径/上级目录穿越，防止服务器任意文件外发
   */
  private async validateAndResolveAttachments(
    attachments: Array<{ path?: string; filename?: string }> | undefined
  ): Promise<Array<{ path: string; filename?: string }>> {
    if (!attachments?.length) return [];
    const { resolve } = await import('path');
    const { existsSync } = await import('fs');

    const base = resolve(resolveAttachmentsDir());
    const allowed = [];

    for (const att of attachments) {
      const raw = att.path || '';
      if (!raw) {
        throw new Error(`MAIL_SEND_FAILED: 附件缺少路径`);
      }
      const abs = resolve(raw);
      if (
        abs !== base &&
        !abs.startsWith(base + '\\') &&
        !abs.startsWith(base + '/')
      ) {
        throw new Error(`MAIL_SEND_FAILED: 附件路径不在允许目录内: ${raw}`);
      }
      if (!existsSync(abs)) {
        throw new Error(`MAIL_SEND_FAILED: 附件文件不存在: ${raw}`);
      }
      allowed.push({
        path: abs,
        filename: att.filename || raw.split(/[\\/]/).pop(),
      });
    }
    return allowed;
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
    // G-17：检查与占位递增在同一同步段完成（无 await 间隙），并发请求不会全部通过检查突破限流
    sendCountThisMinute++;
  }
}
