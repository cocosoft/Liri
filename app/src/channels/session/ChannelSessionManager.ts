/**
 * ChannelSessionManager 通道会话管理器
 */
import { EventEmitter } from 'events';

import type { ChannelId, MessageContext } from '../types/IChannel.js';
import { channelEventBus, ChannelEvents } from '../events/ChannelEventBus.js';
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'channels:session' });

/**
 * 通道会话状态
 */
export type ChannelSessionStatus =
  | 'active'
  | 'idle'
  | 'waiting'
  | 'closed'
  | 'error';

/**
 * 通道会话
 */
export interface ChannelSession {
  id: string;
  channelId: ChannelId;
  conversationId: string;
  participantId: string;
  participantName?: string;
  status: ChannelSessionStatus;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
  metadata: Record<string, unknown>;
}

/**
 * 通道会话事件
 */
export interface ChannelSessionEvent {
  sessionId: string;
  type: 'created' | 'updated' | 'closed' | 'timeout' | 'error';
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 通道会话管理器
 */
export class ChannelSessionManager extends EventEmitter {
  private sessions: Map<string, ChannelSession> = new Map();
  private idleTimeout: number;

  constructor(idleTimeoutMs: number = 30 * 60 * 1000) {
    super();

    this.idleTimeout = idleTimeoutMs;
  }

  /**
   * 创建会话
   */
  create(
    channelId: ChannelId,
    conversationId: string,
    participantId: string,
    participantName?: string
  ): ChannelSession {
    const sessionId = `ch_session_${channelId}_${conversationId}_${Date.now()}`;

    const session: ChannelSession = {
      id: sessionId,
      channelId,
      conversationId,
      participantId,
      participantName,
      status: 'active',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      messageCount: 0,
      metadata: {},
    };

    this.sessions.set(sessionId, session);

    const event: ChannelSessionEvent = {
      sessionId,
      type: 'created',
      timestamp: Date.now(),
      data: { channelId, conversationId, participantId },
    };

    this.emit('session:created', event);
    channelEventBus.publish(ChannelEvents.SESSION_CREATED, event);

    return session;
  }

  /**
   * 获取会话
   */
  get(sessionId: string): ChannelSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 查找会话（按会话ID、渠道ID或参与者ID）
   */
  find(filter: {
    sessionId?: string;
    channelId?: ChannelId;
    conversationId?: string;
    participantId?: string;
  }): ChannelSession[] {
    const results: ChannelSession[] = [];

    for (const session of this.sessions.values()) {
      if (filter.sessionId && session.id !== filter.sessionId) {
        continue;
      }

      if (filter.channelId && session.channelId !== filter.channelId) {
        continue;
      }

      if (
        filter.conversationId &&
        session.conversationId !== filter.conversationId
      ) {
        continue;
      }

      if (
        filter.participantId &&
        session.participantId !== filter.participantId
      ) {
        continue;
      }

      results.push(session);
    }

    return results;
  }

  /**
   * 更新会话活动
   */
  touch(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.lastActivityAt = Date.now();
    session.messageCount++;

    if (session.status === 'idle') {
      session.status = 'active';
    }

    return true;
  }

  /**
   * 更新会话来自消息上下文
   */
  touchFromMessage(context: MessageContext): ChannelSession | undefined {
    const sessions = this.find({
      channelId: context.channelId,
      conversationId: context.conversationId || context.senderId,
      participantId: context.senderId,
    });

    if (sessions.length > 0) {
      this.touch(sessions[0].id);

      return sessions[0];
    }

    return undefined;
  }

  /**
   * 设置会话状态
   */
  setStatus(sessionId: string, status: ChannelSessionStatus): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.status = status;
    session.lastActivityAt = Date.now();

    const event: ChannelSessionEvent = {
      sessionId,
      type: status === 'closed' ? 'closed' : 'updated',
      timestamp: Date.now(),
      data: { status },
    };

    this.emit('session:updated', event);
    channelEventBus.publish(ChannelEvents.SESSION_UPDATED, event);

    return true;
  }

  /**
   * 关闭会话
   */
  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.status = 'closed';
    session.lastActivityAt = Date.now();

    const event: ChannelSessionEvent = {
      sessionId,
      type: 'closed',
      timestamp: Date.now(),
    };

    this.emit('session:closed', event);
    channelEventBus.publish(ChannelEvents.SESSION_CLOSED, event);

    return true;
  }

  /**
   * 获取或创建会话
   */
  getOrCreate(
    channelId: ChannelId,
    conversationId: string,
    participantId: string,
    participantName?: string
  ): ChannelSession {
    const existing = this.find({
      channelId,
      conversationId,
      participantId,
    });

    if (existing.length > 0) {
      this.touch(existing[0].id);

      return existing[0];
    }

    return this.create(
      channelId,
      conversationId,
      participantId,
      participantName
    );
  }

  /**
   * 清理空闲会话
   */
  cleanIdle(): number {
    const now = Date.now();
    let count = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status === 'closed') {
        continue;
      }

      if (now - session.lastActivityAt > this.idleTimeout) {
        session.status = 'idle';

        const event: ChannelSessionEvent = {
          sessionId,
          type: 'timeout',
          timestamp: now,
        };

        this.emit('session:timeout', event);
        channelEventBus.publish(ChannelEvents.SESSION_TIMEOUT, event);
        count++;
      }
    }

    return count;
  }

  /**
   * 获取所有会话
   */
  getAll(): ChannelSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取活跃会话
   */
  getActive(): ChannelSession[] {
    return this.getAll().filter((s) => s.status === 'active');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    active: number;
    idle: number;
    closed: number;
    byChannel: Record<string, number>;
  } {
    let active = 0;
    let idle = 0;
    let closed = 0;
    const byChannel: Record<string, number> = {};

    for (const session of this.sessions.values()) {
      byChannel[session.channelId] = (byChannel[session.channelId] || 0) + 1;

      if (session.status === 'active') {
        active++;
      } else if (session.status === 'idle' || session.status === 'waiting') {
        idle++;
      } else if (session.status === 'closed') {
        closed++;
      }
    }

    return {
      total: this.sessions.size,
      active,
      idle,
      closed,
      byChannel,
    };
  }

  /**
   * 记录 Inbox 项与渠道会话的关联（委托给 InboxManager.linkSession）
   */
  async linkInboxItem(sessionId: string, inboxItemId: string): Promise<void> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      await inboxManager.linkSession(sessionId, inboxItemId);
    } catch (err) {
      await handleError(err, {
        module: 'channels:session',
        action: 'linkInboxItem',
        context: { sessionId, inboxItemId },
      });
    }
  }

  /**
   * 查询某渠道会话关联的所有 Inbox 项 ID
   */
  async getInboxItemIds(sessionId: string): Promise<string[]> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      const items = await inboxManager.getBySession(sessionId);
      return items.map((i) => i.id);
    } catch (err) {
      await handleError(err, {
        module: 'channels:session',
        action: 'getInboxItemIds',
        context: { sessionId },
      });
      return [];
    }
  }
}

export const channelSessionManager = new ChannelSessionManager();
