/**
 * ChannelLogManager 通道日志管理器
 * 对标 OpenClaw channels/logging/，管理通道消息日志和 typing 状态
 */
import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';

import type { ChannelId, MessageContext } from '../types/IChannel.js';
import { getRedactMiddleware } from '../../security/redact/RedactMiddleware';

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志条目
 */
export interface ChannelLogEntry {
  id: string;
  channelId: ChannelId;
  level: LogLevel;
  message: string;
  direction: 'inbound' | 'outbound' | 'internal';
  timestamp: number;
  messageId?: string;
  conversationId?: string;
  senderId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 聊天类型
 */
export type ChatType = 'direct' | 'group' | 'channel' | 'unknown';

/**
 * 聊天元数据
 */
export interface ChatMeta {
  chatId: string;
  type: ChatType;
  displayName: string;
  participantCount: number;
  isBotAdmin: boolean;
}

/**
 * 通道日志管理
 */
export class ChannelLogManager {
  private logs: ChannelLogEntry[] = [];
  private maxLogs: number;
  private logDir: string;
  private persistEnabled: boolean;
  private enableRedact: boolean;

  constructor(
    maxLogs: number = 10000,
    logDir?: string,
    persistEnabled: boolean = false
  ) {
    this.maxLogs = maxLogs;
    this.logDir = logDir || path.join(resolvePyappHome(), 'logs', 'channels');
    this.persistEnabled = persistEnabled;
    this.enableRedact = true;
  }

  /**
   * 设置是否启用日志脱敏
   * @param enable 是否启用
   */
  setRedactEnabled(enable: boolean): void {
    this.enableRedact = enable;
  }

  /**
   * 记录日志
   */
  log(entry: Omit<ChannelLogEntry, 'id' | 'timestamp'>): ChannelLogEntry {
    let redactedMessage = entry.message;

    if (this.enableRedact) {
      redactedMessage = getRedactMiddleware().redactMessage(entry.message);
    }

    const full: ChannelLogEntry = {
      ...entry,
      message: redactedMessage,
      id: `ch_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };

    this.logs.push(full);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    if (this.persistEnabled) {
      this.persist(full);
    }

    return full;
  }

  /**
   * 记录入站消息
   */
  logInbound(
    context: MessageContext,
    level: LogLevel = 'info'
  ): ChannelLogEntry {
    return this.log({
      channelId: context.channelId,
      level,
      message: `[入站] ${context.senderName || context.senderId}: ${context.content.slice(0, 200)}`,
      direction: 'inbound',
      messageId: context.messageId,
      conversationId: context.conversationId,
      senderId: context.senderId,
      metadata: {
        messageType: context.messageType,
        isDirectMessage: context.isDirectMessage,
      },
    });
  }

  /**
   * 记录出站消息
   */
  logOutbound(
    channelId: ChannelId,
    content: string,
    targetId?: string
  ): ChannelLogEntry {
    return this.log({
      channelId,
      level: 'info',
      message: `[出站] -> ${targetId || 'unknown'}: ${content.slice(0, 200)}`,
      direction: 'outbound',
      conversationId: targetId,
    });
  }

  /**
   * 记录错误
   */
  logError(
    channelId: ChannelId,
    error: string,
    context?: Record<string, unknown>
  ): ChannelLogEntry {
    return this.log({
      channelId,
      level: 'error',
      message: `[错误] ${error}`,
      direction: 'internal',
      metadata: context,
    });
  }

  /**
   * 查询日志
   */
  query(filter: {
    channelId?: ChannelId;
    level?: LogLevel;
    direction?: 'inbound' | 'outbound' | 'internal';
    limit?: number;
    offset?: number;
    since?: number;
    until?: number;
  }): ChannelLogEntry[] {
    let results = [...this.logs];

    if (filter.channelId) {
      results = results.filter((e) => e.channelId === filter.channelId);
    }

    if (filter.level) {
      results = results.filter((e) => e.level === filter.level);
    }

    if (filter.direction) {
      results = results.filter((e) => e.direction === filter.direction);
    }

    if (filter.since) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }

    if (filter.until) {
      results = results.filter((e) => e.timestamp <= filter.until!);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    const offset = filter.offset || 0;
    const limit = filter.limit || 100;

    return results.slice(offset, offset + limit);
  }

  /**
   * 获取聊天类型
   */
  getChatType(conversationId: string, participantCount: number): ChatType {
    if (participantCount <= 2) {
      return 'direct';
    }

    if (conversationId.startsWith('group') || conversationId.startsWith('g')) {
      return 'group';
    }

    if (
      conversationId.startsWith('channel') ||
      conversationId.startsWith('c')
    ) {
      return 'channel';
    }

    return 'unknown';
  }

  /**
   * 创建聊天元数据
   */
  createChatMeta(
    chatId: string,
    type: ChatType,
    displayName: string,
    participantCount: number,
    isBotAdmin: boolean
  ): ChatMeta {
    return {
      chatId,
      type,
      displayName,
      participantCount,
      isBotAdmin,
    };
  }

  /**
   * 持久化日志到文件
   */
  private persist(entry: ChannelLogEntry): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }

      const dateStr = new Date(entry.timestamp).toISOString().slice(0, 10);
      const filePath = path.join(
        this.logDir,
        `${entry.channelId}_${dateStr}.log`
      );

      const line = JSON.stringify(entry) + '\n';

      fs.appendFileSync(filePath, line, 'utf-8');
    } catch {
      // 持久化失败不影响主流程
    }
  }

  /**
   * 获取日志统计
   */
  getStats(): {
    total: number;
    byChannel: Record<string, number>;
    byLevel: Record<string, number>;
  } {
    const byChannel: Record<string, number> = {};
    const byLevel: Record<string, number> = {};

    for (const entry of this.logs) {
      byChannel[entry.channelId] = (byChannel[entry.channelId] || 0) + 1;
      byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;
    }

    return {
      total: this.logs.length,
      byChannel,
      byLevel,
    };
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.logs = [];
  }
}

export const channelLogManager = new ChannelLogManager();
