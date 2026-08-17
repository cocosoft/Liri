/**
 * IMAP 邮件读取器
 * 基于 imapflow，支持 OAuth2
 * MAIL_IMAP flag 控制
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { EmailConfigService } from './EmailConfigService';
import { resolvePlainPassword } from './crypto';

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
  /** G-5：兼容前端 MailItem.from（前端读取 from 字段） */
  from: string;
  date: string;
  /** 正文纯文本（无正文时回退主题）——修复"邮件正文仍显示主题"问题 */
  snippet: string;
}

/** 简单 HTML → 纯文本（换行保留，用于 html-only 邮件兜底） */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从 imapflow 解析的 MIME body 结构（body: true 返回）中递归提取正文纯文本。
 * 优先 text/plain；无 plain 时用 text/html 转纯文本兜底。
 */
function extractMailBody(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: unknown; childNodes?: unknown[] };

  if (n.type === 'text/plain' && typeof n.text === 'string' && n.text.trim()) {
    return n.text.trim();
  }
  if (n.type === 'text/html' && typeof n.text === 'string' && n.text.trim()) {
    return htmlToText(n.text);
  }
  if (Array.isArray(n.childNodes)) {
    for (const child of n.childNodes) {
      const text = extractMailBody(child);
      if (text) return text;
    }
  }
  return '';
}

/** 正文摘要：截断到 500 字符，无正文时回退主题 */
function buildSnippet(bodyText: string, subject: string): string {
  const text = bodyText || subject || '';
  return text.slice(0, 500);
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
   * 动态加载 imapflow（可选原生模块）
   * 构建时标记为 external，运行时按需加载。
   */
  private async getImapFlow(): Promise<any> {
    try {
      return await import('imapflow');
    } catch {
      throw new Error('MAIL_MODULE: imapflow 未安装。请运行 bun add imapflow');
    }
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

    const client = await this.getImapFlow().then(
      ({ ImapFlow }) => new ImapFlow(this.buildImapConfig(account))
    );

    try {
      await client.connect();

      // 遗留项 1：空收件箱（exists=0）直接返回，避免 fetch({start:1, end:0}) 无效范围抛错
      const mailbox = await client.mailboxOpen('INBOX');
      if (!mailbox.exists) {
        await client.logout();
        return [];
      }

      const messages: EmailSummary[] = [];

      for await (const msg of client.fetch(
        { start: Math.max(1, mailbox.exists - limit + 1), end: mailbox.exists },
        {
          uid: true,
          envelope: true,
          bodyStructure: true,
          body: true,
          source: false,
        }
      )) {
        const fromAddr = msg.envelope.from?.[0]?.address || '';
        messages.push({
          uid: msg.uid,
          folder: 'INBOX',
          messageId: msg.envelope.messageId || '',
          subject: msg.envelope.subject || '',
          fromAddr,
          from: fromAddr,
          date: msg.envelope.date?.toISOString() || '',
          snippet: buildSnippet(
            extractMailBody(msg.body),
            msg.envelope.subject || ''
          ),
        });
      }

      await client.logout();
      return messages;
    } catch (error) {
      // G-4/D-7：读取失败用正确的读取错误码（原误用 MAIL_SEND_FAILED）
      throw new Error(
        `MAIL_READ_FAILED: IMAP 读取失败 - ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // G-4：无论成功失败都确保连接被关闭，防止连接泄漏
      try {
        client.close();
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 搜索邮件
   * BUG-6：基于 imapflow SEARCH 实现，支持 TEXT 全文搜索
   */
  async search(query: string, limit: number = 20): Promise<EmailSummary[]> {
    logger.info('IMAP 邮件搜索', { query, limit });
    const accounts = this.configService.getAccounts();
    if (accounts.length === 0) {
      throw new Error('MAIL_AUTH_FAILED: 未配置邮箱账户');
    }
    if (!query) return [];

    const account = accounts[0];
    const client = await this.getImapFlow().then(
      ({ ImapFlow }) => new ImapFlow(this.buildImapConfig(account))
    );

    try {
      await client.connect();
      const mailbox = await client.mailboxOpen('INBOX');

      // 遗留项 1：空收件箱直接返回空结果（避免无效 search range）
      if (!mailbox.exists) {
        await client.logout();
        return [];
      }

      // IMAP TEXT 搜索（按主题/正文/发件人匹配），限定最近 limit*10 封提升效率
      const range = {
        start: Math.max(1, mailbox.exists - limit * 10 + 1),
        end: mailbox.exists,
      };
      const searchUids = await client.search(
        { text: query },
        { uid: true, range }
      );

      const messages: EmailSummary[] = [];
      if (searchUids.length > 0) {
        const capped = searchUids.slice(-limit);
        for await (const msg of client.fetch(capped, {
          uid: true,
          envelope: true,
          bodyStructure: true,
          body: true,
          source: false,
        })) {
          const fromAddr = msg.envelope.from?.[0]?.address || '';
          messages.push({
            uid: msg.uid,
            folder: 'INBOX',
            messageId: msg.envelope.messageId || '',
            subject: msg.envelope.subject || '',
            fromAddr,
            from: fromAddr,
            date: msg.envelope.date?.toISOString() || '',
            snippet: buildSnippet(
              extractMailBody(msg.body),
              msg.envelope.subject || ''
            ),
          });
        }
      }

      await client.logout();
      return messages;
    } catch (error) {
      throw new Error(
        `MAIL_READ_FAILED: IMAP 搜索失败 - ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      try {
        client.close();
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 标记已读/未读
   */
  async markRead(uid: number, read: boolean): Promise<void> {
    const accounts = this.configService.getAccounts();
    if (accounts.length === 0) throw new Error('未配置邮箱账户');

    const { ImapFlow } = await this.getImapFlow();
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
        // BUG-2：存储的是密文，认证前必须解密为明文
        pass: resolvePlainPassword(account.pass),
      },
    };
  }
}
