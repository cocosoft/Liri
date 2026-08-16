/**
 * UnifiedStorageAdapter
 * 桥接 UnifiedSessionStorage（Gateway 使用）与 SessionStorage（SessionStore/SessionPruner 使用）
 * 实现旧的 SessionStorage 接口，内部将调用委托给 UnifiedSessionStorage
 */

import { SessionType, SessionStatus } from '../types/Session.js';
import type { UnifiedSession } from '../types/Session.js';
import type {
  UnifiedMessage,
  MessageType as UnifiedMsgType,
  MessageRole,
} from '../types/Message.js';
import type {
  UnifiedSessionStorage,
  UnifiedMessageQueryOptions,
} from './UnifiedStorage.js';

import { Session } from '../models/Session.js';
import { SessionMessage } from '../models/SessionMessage.js';
import { SessionMetadata } from '../models/SessionMetadata.js';
import { SessionState } from '../models/SessionState.js';
import type {
  SessionStorage,
  MessageLoadOptions,
  SessionListOptions,
} from '../SessionStorage.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('session:storage:adapter');

/**
 * 将旧 Session（含 Date 类型）转换为 UnifiedSession（number 时间戳）
 */
function toUnifiedSession(old: Session): UnifiedSession {
  const statusMap: Record<string, SessionStatus> = {
    active: SessionStatus.ACTIVE,
    paused: SessionStatus.PAUSED,
    ended: SessionStatus.ENDED,
    archived: SessionStatus.ARCHIVED,
    idle: SessionStatus.IDLE,
    running: SessionStatus.RUNNING,
    error: SessionStatus.ERROR,
  };

  return {
    id: old.id,
    type: SessionType.LOCAL,
    createdAt:
      old.createdAt instanceof Date ? old.createdAt.getTime() : Date.now(),
    updatedAt:
      old.updatedAt instanceof Date ? old.updatedAt.getTime() : Date.now(),
    lastActivityAt:
      old.updatedAt instanceof Date ? old.updatedAt.getTime() : Date.now(),
    status: statusMap[old.state?.currentState] ?? SessionStatus.ACTIVE,
    metadata: {
      title: old.metadata?.title ?? '',
      tags: old.metadata?.tags ?? [],
      mode: old.metadata?.mode ?? 'default',
    },
  };
}

/**
 * 将 UnifiedSession 转换为旧 Session（含 Date 类型）
 */
function toOldSession(unified: UnifiedSession): Session {
  const metadata = new SessionMetadata(
    unified.metadata?.title ?? '',
    unified.metadata?.tags ?? [],
    unified.metadata?.mode ?? 'default'
  );

  // H1 修复（2026-08-13）：补全 IDLE/RUNNING/ERROR 映射——原实现仅映射
  // ACTIVE/PAUSED/ENDED/ARCHIVED，其余状态全部落入 'active' 分支，导致
  // 持久化 status=IDLE 的会话被误读为 active（SessionSupervisor 空闲回收
  // 永不命中——"意外安全"但语义错误）。补全后状态双向映射对称。
  const statusMap: Record<string, string> = {
    [SessionStatus.ACTIVE]: 'active',
    [SessionStatus.PAUSED]: 'paused',
    [SessionStatus.ENDED]: 'ended',
    [SessionStatus.ARCHIVED]: 'archived',
    [SessionStatus.IDLE]: 'idle',
    [SessionStatus.RUNNING]: 'running',
    [SessionStatus.ERROR]: 'error',
  };

  const state = new SessionState(statusMap[unified.status] ?? 'active');

  return new Session(
    unified.id,
    metadata,
    state,
    [],
    new Date(unified.createdAt),
    new Date(unified.updatedAt)
  );
}

/**
 * 将旧 SessionMessage 转换为 UnifiedMessage
 */
function toUnifiedMessage(
  sessionId: string,
  msg: SessionMessage
): UnifiedMessage {
  const typeMap: Record<string, UnifiedMsgType> = {
    user: 'user' as UnifiedMsgType,
    assistant: 'assistant' as UnifiedMsgType,
    system: 'system' as UnifiedMsgType,
    tool: 'tool_use' as UnifiedMsgType,
  };

  const roleMap: Record<string, MessageRole> = {
    user: 'user' as MessageRole,
    assistant: 'assistant' as MessageRole,
    system: 'system' as MessageRole,
    tool: 'tool' as MessageRole,
  };

  return {
    id: msg.id,
    sessionId,
    type: typeMap[msg.type] ?? ('user' as UnifiedMsgType),
    role: roleMap[msg.type] ?? ('user' as MessageRole),
    content: msg.content,
    timestamp:
      msg.createdAt instanceof Date ? msg.createdAt.getTime() : Date.now(),
    parentUuid: msg.parentId,
    metadata: msg.toolResult ? { toolCallId: msg.id, toolName: '' } : undefined,
  };
}

/**
 * 将 UnifiedMessage 转换为旧 SessionMessage
 */
function toOldSessionMessage(msg: UnifiedMessage): SessionMessage {
  const typeMap: Record<string, string> = {
    user: 'user',
    assistant: 'assistant',
    system: 'system',
    tool_use: 'tool',
    tool_result: 'tool',
    progress: 'assistant',
    embedding: 'system',
    error: 'system',
  };

  const contentStr =
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

  return new SessionMessage(
    msg.id,
    typeMap[msg.type] as any,
    contentStr,
    new Date(msg.timestamp),
    msg.parentUuid
  );
}

/**
 * 统一存储适配器
 * 将 UnifiedSessionStorage 适配为旧的 SessionStorage 接口
 */
export class UnifiedStorageAdapter implements SessionStorage {
  private storage: UnifiedSessionStorage;

  constructor(storage: UnifiedSessionStorage) {
    this.storage = storage;
  }

  async saveSession(session: Session): Promise<void> {
    const unified = toUnifiedSession(session);
    const exists = await this.storage.sessionIdExists(session.id);
    if (exists) {
      await this.storage.updateSession(unified);
    } else {
      await this.storage.createSession(unified);
    }
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    const unified = await this.storage.getSession(sessionId);
    if (!unified) return null;
    return toOldSession(unified);
  }

  async saveMessage(sessionId: string, message: SessionMessage): Promise<void> {
    const unified = toUnifiedMessage(sessionId, message);
    await this.storage.addMessage(sessionId, unified);
  }

  async loadMessages(
    sessionId: string,
    options?: MessageLoadOptions
  ): Promise<SessionMessage[]> {
    const queryOptions: UnifiedMessageQueryOptions = {};
    if (options?.limit) queryOptions.limit = options.limit;
    if (options?.offset) queryOptions.offset = options.offset;
    if (options?.since) queryOptions.startDate = options.since.getTime();
    if (options?.until) queryOptions.endDate = options.until.getTime();

    const unifiedMessages = await this.storage.getMessages(
      sessionId,
      queryOptions
    );
    return unifiedMessages.map(toOldSessionMessage);
  }

  async saveMetadata(
    sessionId: string,
    metadata: SessionMetadata
  ): Promise<void> {
    const session = await this.storage.getSession(sessionId);
    if (session) {
      session.metadata = {
        ...session.metadata,
        title: metadata.title,
        tags: metadata.tags,
        mode: metadata.mode,
      };
      await this.storage.updateSession(session);
    }
  }

  async loadMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const session = await this.storage.getSession(sessionId);
    if (!session) return null;

    const { SessionMetadata } =
      require('../models/SessionMetadata.js') as typeof import('../models/SessionMetadata.js');
    return SessionMetadata.fromJSON({
      title: session.metadata?.title ?? '',
      tags: session.metadata?.tags ?? [],
      mode: session.metadata?.mode ?? 'default',
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    logger.debug('deleteSession:桥接 UnifiedSessionStorage（旧接口 → 新链）', {
      sessionId,
    });
    await this.storage.deleteSession(sessionId);
  }

  async listSessions(options?: SessionListOptions): Promise<string[]> {
    const sessions = await this.storage.listSessions();
    let result = sessions;

    if (options?.since) {
      const since = options.since.getTime();
      result = result.filter((s) => s.updatedAt >= since);
    }
    if (options?.until) {
      const until = options.until.getTime();
      result = result.filter((s) => s.updatedAt <= until);
    }
    if (options?.tags?.length) {
      result = result.filter((s) =>
        options.tags!.some((tag) => s.metadata?.tags?.includes(tag))
      );
    }
    if (options?.mode) {
      result = result.filter((s) => s.metadata?.mode === options.mode);
    }

    if (options?.offset) {
      result = result.slice(options.offset);
    }
    if (options?.limit) {
      result = result.slice(0, options.limit);
    }

    return result.map((s) => s.id);
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    return this.storage.sessionIdExists(sessionId);
  }

  async compactSession(sessionId: string): Promise<void> {
    logger.debug('compactSession:桥接 UnifiedSessionStorage（旧接口 → 新链）', {
      sessionId,
    });
    const session = await this.storage.getSession(sessionId);
    if (!session) return;

    const messages = await this.storage.getMessages(sessionId);
    if (messages.length > 1) {
      const keepCount = Math.ceil(messages.length / 2);
      const toDelete = messages.slice(0, messages.length - keepCount);
      await this.storage.deleteMessages(
        sessionId,
        toDelete.map((m) => m.id)
      );
    }
  }
}
