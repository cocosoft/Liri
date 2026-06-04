/**
 * Teammate Mailbox系统
 * 提供结构化的团队消息传递，支持shutdown、plan_approval等消息类型
 * 参考CC源码 cc_code/backend/utils/teammateMailbox.ts 实现
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * Mailbox消息类型
 */
export type MailboxMessageType =
  | 'shutdown_request'
  | 'shutdown_response'
  | 'plan_approval_request'
  | 'plan_approval_response'
  | 'permission_request'
  | 'permission_response'
  | 'general';

/**
 * Mailbox消息基类
 */
export interface MailboxMessage {
  id: string;
  type: MailboxMessageType;
  senderId: string;
  senderName: string;
  recipientId?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/**
 * Shutdown请求消息
 */
export interface ShutdownRequestMessage extends MailboxMessage {
  type: 'shutdown_request';
  payload: {
    reason?: string;
    graceful?: boolean;
    timeout?: number;
  };
}

/**
 * Shutdown响应消息
 */
export interface ShutdownResponseMessage extends MailboxMessage {
  type: 'shutdown_response';
  payload: {
    code?: number;
    reason?: string;
  };
}

/**
 * Plan审批请求消息
 */
export interface PlanApprovalRequestMessage extends MailboxMessage {
  type: 'plan_approval_request';
  payload: {
    plan: string;
    taskId: string;
  };
}

/**
 * Plan审批响应消息
 */
export interface PlanApprovalResponseMessage extends MailboxMessage {
  type: 'plan_approval_response';
  payload: {
    approved: boolean;
    feedback?: string;
    modifiedPlan?: string;
  };
}

/**
 * 权限请求消息
 */
export interface PermissionRequestMessage extends MailboxMessage {
  type: 'permission_request';
  payload: {
    toolName: string;
    toolUseId: string;
    description: string;
    input: Record<string, unknown>;
  };
}

/**
 * 权限响应消息
 */
export interface PermissionResponseMessage extends MailboxMessage {
  type: 'permission_response';
  payload: {
    approved: boolean;
    feedback?: string;
    updatedInput?: Record<string, unknown>;
  };
}

/**
 * Mailbox配置
 */
export interface MailboxConfig {
  mailboxDir: string;
  messageTtlMs: number;
  cleanupIntervalMs: number;
}

/**
 * Mailbox管理器
 */
export class TeammateMailbox {
  private mailboxDir: string;
  private messageTtlMs: number;
  private cleanupIntervalMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<MailboxConfig> = {}) {
    this.mailboxDir = config.mailboxDir || join(resolvePyappHome(), 'mailbox');
    this.messageTtlMs = config.messageTtlMs || 24 * 60 * 60 * 1000; // 24小时
    this.cleanupIntervalMs = config.cleanupIntervalMs || 60 * 60 * 1000; // 1小时

    this.ensureMailboxDir();
    this.startCleanupTimer();
  }

  /**
   * 确保mailbox目录存在
   */
  private ensureMailboxDir(): void {
    if (!existsSync(this.mailboxDir)) {
      mkdirSync(this.mailboxDir, { recursive: true });
    }
  }

  /**
   * 获取 mailbox 文件路径
   */
  private getMailboxPath(recipientId: string): string {
    return join(this.mailboxDir, `${recipientId}.json`);
  }

  /**
   * 写入消息到 mailbox
   */
  writeToMailbox(recipientId: string, message: MailboxMessage): void {
    const mailboxPath = this.getMailboxPath(recipientId);

    try {
      let messages: MailboxMessage[] = [];

      if (existsSync(mailboxPath)) {
        try {
          const content = readFileSync(mailboxPath, 'utf-8');
          messages = JSON.parse(content);
        } catch {
          messages = [];
        }
      }

      messages.push(message);

      writeFileSync(mailboxPath, JSON.stringify(messages, null, 2), 'utf-8');
      logger.debug(`Wrote message to mailbox ${recipientId}: ${message.type}`);
    } catch (error) {
      logger.error(
        `Failed to write to mailbox ${recipientId}:`,
        error as Error
      );
    }
  }

  /**
   * 读取 mailbox 中的所有消息
   */
  readMailbox(recipientId: string): MailboxMessage[] {
    const mailboxPath = this.getMailboxPath(recipientId);

    if (!existsSync(mailboxPath)) {
      return [];
    }

    try {
      const content = readFileSync(mailboxPath, 'utf-8');
      const messages = JSON.parse(content) as MailboxMessage[];

      // 过滤过期消息
      const now = Date.now();
      return messages.filter(
        (m: MailboxMessage) => now - m.timestamp < this.messageTtlMs
      );
    } catch {
      return [];
    }
  }

  /**
   * 读取并清空 mailbox
   */
  readAndClearMailbox(recipientId: string): MailboxMessage[] {
    const messages = this.readMailbox(recipientId);
    this.clearMailbox(recipientId);
    return messages;
  }

  /**
   * 清空 mailbox
   */
  clearMailbox(recipientId: string): void {
    const mailboxPath = this.getMailboxPath(recipientId);

    try {
      if (existsSync(mailboxPath)) {
        unlinkSync(mailboxPath);
      }
    } catch (error) {
      logger.error(`Failed to clear mailbox ${recipientId}:`, error as Error);
    }
  }

  /**
   * 获取指定类型的消息
   */
  getMessagesByType(
    recipientId: string,
    type: MailboxMessageType
  ): MailboxMessage[] {
    const messages = this.readMailbox(recipientId);
    return messages.filter((m: MailboxMessage) => m.type === type);
  }

  /**
   * 获取发送者的消息
   */
  getMessagesFromSender(
    recipientId: string,
    senderId: string
  ): MailboxMessage[] {
    const messages = this.readMailbox(recipientId);
    return messages.filter((m: MailboxMessage) => m.senderId === senderId);
  }

  /**
   * 创建基础消息
   */
  createMessage(
    type: MailboxMessageType,
    senderId: string,
    senderName: string,
    payload: Record<string, unknown>,
    recipientId?: string
  ): MailboxMessage {
    return {
      id: `msg-${Date.now()}-${randomUUID().substring(0, 8)}`,
      type,
      senderId,
      senderName,
      recipientId,
      timestamp: Date.now(),
      payload,
    };
  }

  /**
   * 创建 Shutdown 请求
   */
  createShutdownRequest(
    senderId: string,
    senderName: string,
    recipientId: string,
    reason?: string,
    graceful: boolean = true,
    timeout?: number
  ): ShutdownRequestMessage {
    const message = this.createMessage(
      'shutdown_request',
      senderId,
      senderName,
      {
        reason,
        graceful,
        timeout,
      },
      recipientId
    ) as ShutdownRequestMessage;
    return message;
  }

  /**
   * 创建 Shutdown 响应
   */
  createShutdownResponse(
    senderId: string,
    senderName: string,
    recipientId: string,
    code?: number,
    reason?: string
  ): ShutdownResponseMessage {
    const message = this.createMessage(
      'shutdown_response',
      senderId,
      senderName,
      {
        code,
        reason,
      },
      recipientId
    ) as ShutdownResponseMessage;
    return message;
  }

  /**
   * 创建 Plan 审批请求
   */
  createPlanApprovalRequest(
    senderId: string,
    senderName: string,
    recipientId: string,
    plan: string,
    taskId: string
  ): PlanApprovalRequestMessage {
    const message = this.createMessage(
      'plan_approval_request',
      senderId,
      senderName,
      {
        plan,
        taskId,
      },
      recipientId
    ) as PlanApprovalRequestMessage;
    return message;
  }

  /**
   * 创建 Plan 审批响应
   */
  createPlanApprovalResponse(
    senderId: string,
    senderName: string,
    recipientId: string,
    approved: boolean,
    feedback?: string,
    modifiedPlan?: string
  ): PlanApprovalResponseMessage {
    const message = this.createMessage(
      'plan_approval_response',
      senderId,
      senderName,
      {
        approved,
        feedback,
        modifiedPlan,
      },
      recipientId
    ) as PlanApprovalResponseMessage;
    return message;
  }

  /**
   * 创建权限请求
   */
  createPermissionRequest(
    senderId: string,
    senderName: string,
    recipientId: string,
    toolName: string,
    toolUseId: string,
    description: string,
    input: Record<string, unknown>
  ): PermissionRequestMessage {
    const message = this.createMessage(
      'permission_request',
      senderId,
      senderName,
      {
        toolName,
        toolUseId,
        description,
        input,
      },
      recipientId
    ) as PermissionRequestMessage;
    return message;
  }

  /**
   * 创建权限响应
   */
  createPermissionResponse(
    senderId: string,
    senderName: string,
    recipientId: string,
    approved: boolean,
    feedback?: string,
    updatedInput?: Record<string, unknown>
  ): PermissionResponseMessage {
    const message = this.createMessage(
      'permission_response',
      senderId,
      senderName,
      {
        approved,
        feedback,
        updatedInput,
      },
      recipientId
    ) as PermissionResponseMessage;
    return message;
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredMessages();
    }, this.cleanupIntervalMs);
  }

  /**
   * 清理过期消息
   */
  private cleanupExpiredMessages(): void {
    const {
      readdirSync,
      unlinkSync,
      readFileSync,
      writeFileSync,
    } = require('fs');

    try {
      const files = readdirSync(this.mailboxDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.mailboxDir, file);

        try {
          const content = readFileSync(filePath, 'utf-8');
          let messages = JSON.parse(content) as MailboxMessage[];
          const originalCount = messages.length;

          messages = messages.filter(
            (m: MailboxMessage) => now - m.timestamp < this.messageTtlMs
          );

          if (messages.length < originalCount) {
            if (messages.length > 0) {
              writeFileSync(
                filePath,
                JSON.stringify(messages, null, 2),
                'utf-8'
              );
            } else {
              unlinkSync(filePath);
            }
            logger.debug(
              `Cleaned up ${originalCount - messages.length} expired messages from ${file}`
            );
          }
        } catch {
          // 忽略无法处理的文件
        }
      }
    } catch {
      // 忽略目录读取错误
    }
  }

  /**
   * 停止清理定时器
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * 获取mailbox状态
   */
  getStatus(): { mailboxCount: number; totalMessages: number } {
    const { readdirSync, readFileSync } = require('fs');

    try {
      const files = readdirSync(this.mailboxDir);
      let totalMessages = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = readFileSync(join(this.mailboxDir, file), 'utf-8');
          const messages = JSON.parse(content);
          totalMessages += Array.isArray(messages) ? messages.length : 0;
        } catch {
          // 忽略无法读取的文件
        }
      }

      return {
        mailboxCount: files.filter((f: string) => f.endsWith('.json')).length,
        totalMessages,
      };
    } catch {
      return { mailboxCount: 0, totalMessages: 0 };
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopCleanup();
    this.mailboxDir = '';
  }
}

/**
 * 导出单例
 */
export const teammateMailbox = new TeammateMailbox();

/**
 * 便捷函数：写入 mailbox
 */
export function writeToMailbox(
  recipientId: string,
  message: MailboxMessage
): void {
  teammateMailbox.writeToMailbox(recipientId, message);
}

/**
 * 便捷函数：读取 mailbox
 */
export function readMailbox(recipientId: string): MailboxMessage[] {
  return teammateMailbox.readMailbox(recipientId);
}

/**
 * 便捷函数：创建 shutdown 请求消息
 */
export function createShutdownRequestMessage(
  senderId: string,
  senderName: string,
  recipientId: string,
  reason?: string
): ShutdownRequestMessage {
  return teammateMailbox.createShutdownRequest(
    senderId,
    senderName,
    recipientId,
    reason
  );
}

/**
 * 便捷函数：创建 shutdown 响应消息
 */
export function createShutdownResponseMessage(
  senderId: string,
  senderName: string,
  recipientId: string,
  code?: number,
  reason?: string
): ShutdownResponseMessage {
  return teammateMailbox.createShutdownResponse(
    senderId,
    senderName,
    recipientId,
    code,
    reason
  );
}
