/**
 * IMAP 邮件读取器
 * 基于 imapflow，支持 OAuth2
 * MAIL_IMAP flag 控制
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { EmailConfigService } from './EmailConfigService';

const logger = new Logger({
  module: 'mail:email',
  level: LogLevel.INFO,
});

/** 邮件摘要 */
export interface EmailSummary {
  uid: number;
  folder: string;
  messageId: string;
  subject: string;
  fromAddr: string;
  date: string;
  snippet: string;
}

/**
 * IMAP 邮件读取器
 */
export class EmailReader {
  private configService: EmailConfigService;

  constructor(configService: EmailConfigService) {
    this.configService = configService;
  }

  /**
   * 读取收件箱
   */
  async inbox(limit: number = 20): Promise<EmailSummary[]> {
    const accounts = this.configService.getAccounts();
    if (accounts.length === 0) {
      throw new Error('MAIL_AUTH_FAILED: 未配置邮箱账户');
    }

    const account = accounts[0];
    logger.info('IMAP 收件箱读取', { limit });

    try {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow(this.buildImapConfig(account));
      await client.connect();

      const messages: EmailSummary[] = [];
      const mailbox = await client.mailboxOpen('INBOX');

      for await (const msg of client.fetch(
        { start: Math.max(1, mailbox.exists - limit + 1), end: mailbox.exists },
        { uid: true, envelope: true, bodyStructure: true, source: false }
      )) {
        messages.push({
          uid: msg.uid,
          folder: 'INBOX',
          messageId: msg.envelope.messageId || '',
          subject: msg.envelope.subject || '',
          fromAddr: msg.envelope.from?.[0]?.address || '',
          date: msg.envelope.date?.toISOString() || '',
          snippet: msg.envelope.subject || '',
        });
      }

      await client.logout();
      return messages;
    } catch (error: any) {
      throw new Error(`MAIL_SEND_FAILED: IMAP 读取失败 - ${error.message}`);
    }
  }

  /**
   * 搜索邮件
   */
  async search(query: string, limit: number = 20): Promise<EmailSummary[]> {
    logger.info('IMAP 邮件搜索', { query, limit });
    // TODO: imapflow SEARCH - X-GM-RAW for Gmail, TEXT for standard
    return [];
  }

  /**
   * 标记已读/未读
   */
  async markRead(uid: number, read: boolean): Promise<void> {
    const accounts = this.configService.getAccounts();
    if (accounts.length === 0) throw new Error('未配置邮箱账户');

    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow(this.buildImapConfig(accounts[0]));

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      if (read) {
        await client.messageFlagsAdd(`${uid}`, ['\\Seen']);
      } else {
        await client.messageFlagsRemove(`${uid}`, ['\\Seen']);
      }
      logger.info(read ? '邮件已标记已读' : '邮件已标记未读', { uid });
    } finally {
      try {
        client.close();
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 构建 IMAP 连接配置
   */
  private buildImapConfig(account: any): Record<string, any> {
    return {
      host: account.imapHost || account.smtpHost?.replace('smtp', 'imap'),
      port: account.imapPort || 993,
      secure: true,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    };
  }
}
