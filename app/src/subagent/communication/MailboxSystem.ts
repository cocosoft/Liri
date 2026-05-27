/**
 * 邮箱系统
 */
import { Message } from '../SubAgentCommunicator';
import { join } from 'path';
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 邮箱系统
 */
export class MailboxSystem {
  private mailboxes: Map<string, Message[]> = new Map();
  private mailboxDir: string;

  /**
   * 构造函数
   * @param mailboxDir 邮箱目录
   */
  constructor(mailboxDir: string = join(process.cwd(), '.mailboxes')) {
    this.mailboxDir = mailboxDir;

    // 创建邮箱目录
    if (!existsSync(this.mailboxDir)) {
      mkdirSync(this.mailboxDir, { recursive: true });
    }
  }

  /**
   * 创建邮箱
   * @param id 邮箱ID
   */
  createMailbox(id: string): void {
    if (!this.mailboxes.has(id)) {
      this.mailboxes.set(id, []);
      logger.info(`Created mailbox for ${id}`);
    }
  }

  /**
   * 删除邮箱
   * @param id 邮箱ID
   */
  deleteMailbox(id: string): void {
    this.mailboxes.delete(id);

    // 删除邮箱文件
    const mailboxFile = join(this.mailboxDir, `${id}.json`);
    if (existsSync(mailboxFile)) {
      unlinkSync(mailboxFile);
    }

    logger.info(`Deleted mailbox for ${id}`);
  }

  /**
   * 发送消息
   * @param sender 发送者ID
   * @param receiver 接收者ID
   * @param message 消息
   */
  sendMessage(sender: string, receiver: string, message: Message): void {
    // 确保接收者邮箱存在
    if (!this.mailboxes.has(receiver)) {
      this.createMailbox(receiver);
    }

    // 添加消息到接收者邮箱
    const mailbox = this.mailboxes.get(receiver);
    if (mailbox) {
      mailbox.push(message);
      logger.info(`Message sent from ${sender} to ${receiver}:`, { message });

      // 持久化消息到文件
      this.persistMailbox(receiver);
    }
  }

  /**
   * 接收消息
   * @param receiver 接收者ID
   * @returns 消息数组
   */
  receiveMessages(receiver: string): Message[] {
    // 确保接收者邮箱存在
    if (!this.mailboxes.has(receiver)) {
      this.createMailbox(receiver);
    }

    // 加载邮箱文件
    this.loadMailbox(receiver);

    // 获取并清空邮箱
    const mailbox = this.mailboxes.get(receiver);
    if (mailbox) {
      const messages = [...mailbox];
      mailbox.length = 0;

      // 清空邮箱文件
      this.persistMailbox(receiver);

      logger.info(`Messages received for ${receiver}:`, {
        count: messages.length,
      });
      return messages;
    }

    return [];
  }

  /**
   * 获取邮箱中的消息数量
   * @param id 邮箱ID
   * @returns 消息数量
   */
  getMessageCount(id: string): number {
    // 加载邮箱文件
    this.loadMailbox(id);

    const mailbox = this.mailboxes.get(id);
    return mailbox ? mailbox.length : 0;
  }

  /**
   * 检查邮箱是否存在
   * @param id 邮箱ID
   * @returns 是否存在
   */
  hasMailbox(id: string): boolean {
    return (
      this.mailboxes.has(id) || existsSync(join(this.mailboxDir, `${id}.json`))
    );
  }

  /**
   * 持久化邮箱到文件
   * @param id 邮箱ID
   */
  private persistMailbox(id: string): void {
    const mailbox = this.mailboxes.get(id);
    if (mailbox) {
      const mailboxFile = join(this.mailboxDir, `${id}.json`);
      writeFileSync(mailboxFile, JSON.stringify(mailbox, null, 2));
    }
  }

  /**
   * 从文件加载邮箱
   * @param id 邮箱ID
   */
  private loadMailbox(id: string): void {
    const mailboxFile = join(this.mailboxDir, `${id}.json`);
    if (existsSync(mailboxFile)) {
      try {
        const messages = JSON.parse(readFileSync(mailboxFile, 'utf8'));
        this.mailboxes.set(id, messages);
      } catch (error) {
        logger.error(`Error loading mailbox for ${id}:`, { error });
        // 如果加载失败，创建空邮箱
        this.mailboxes.set(id, []);
      }
    }
  }

  /**
   * 清理所有邮箱
   */
  cleanup(): void {
    const mailboxIds = Array.from(this.mailboxes.keys());
    for (const id of mailboxIds) {
      this.deleteMailbox(id);
    }
  }
}

/**
 * 创建邮箱系统
 * @param mailboxDir 邮箱目录
 * @returns 邮箱系统实例
 */
export function createMailboxSystem(mailboxDir?: string): MailboxSystem {
  return new MailboxSystem(mailboxDir);
}
