/**
 * 邮件工具 — EmailTool
 * SMTP 发送 + IMAP 读取 + OAuth2 认证
 *
 * 注册到 ToolManager，供 AI Agent 调用
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { EmailSender } from './EmailSender';
import { EmailReader } from './EmailReader';
import { EmailConfigService } from './EmailConfigService';

import type { EmailSendArgs, EmailSendResult, EmailAccount } from '@modules/mail/types';

const logger = new Logger({
  module: 'mail:tool',
  level: LogLevel.INFO,
});

/**
 * EmailTool
 * 邮件收发核心工具
 */
export class EmailTool {
  readonly sender: EmailSender;
  readonly reader: EmailReader;
  readonly configService: EmailConfigService;

  constructor() {
    this.configService = new EmailConfigService();
    this.sender = new EmailSender(this.configService);
    this.reader = new EmailReader(this.configService);
  }

  /**
   * 发送邮件（支持 OAuth2 + 附件）
   */
  async send(args: EmailSendArgs): Promise<EmailSendResult> {
    await this.configService.load();
    return this.sender.send(args);
  }

  /**
   * 读取收件箱（需 MAIL_IMAP flag）
   */
  async inbox(limit: number = 20) {
    return this.reader.inbox(limit);
  }

  /**
   * 搜索邮件
   */
  async search(query: string, limit: number = 20) {
    return this.reader.search(query, limit);
  }

  /**
   * 配置邮箱账户
   */
  async config(account: EmailAccount): Promise<void> {
    if (account.authMethod === 'oauth2') {
      logger.info('OAuth2 邮箱配置', { provider: account.provider });
    }
    await this.configService.addAccount(account);
  }

  /**
   * 获取已配置账户
   */
  getAccounts(): EmailAccount[] {
    return this.configService.getAccounts();
  }
}
