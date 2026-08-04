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

import type {
  EmailSendArgs,
  EmailSendResult,
  EmailAccount,
} from '@modules/mail/types';

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

  /**
   * IMAP 连通性测试
   * 在保存配置前验证凭据是否有效
   */
  async testConnection(
    account: Record<string, unknown>
  ): Promise<{ ok: boolean }> {
    try {
      var { ImapFlow } = await import('imapflow');
    } catch {
      throw new Error('MAIL_MODULE: imapflow 未安装，无法测试 IMAP 连接。请运行 bun add imapflow');
    }

    const client = new ImapFlow({
      host: account.imapHost || 'imap.gmail.com',
      port: (account.imapPort as number) || 993,
      secure: true,
      auth: {
        user: account.user as string,
        pass: account.pass as string,
      },
    });

    try {
      await client.connect();
      await client.logout();
      return { ok: true };
    } finally {
      // 确保连接被关闭（即使 logout 失败）
      try {
        client.close();
      } catch {
        /* 忽略 */
      }
    }
  }
}
