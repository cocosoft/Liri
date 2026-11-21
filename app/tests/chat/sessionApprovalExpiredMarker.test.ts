// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-21（真机治理 P1-2 产品决策）：「审批已过期（未执行）」标记的**清除**回归锁。
 *
 * 合同：
 * - 过期时由 `convergeSessionAfterApprovalExpiry` 写 `metadata.approvalExpiredAt`（见
 *   `tests/runtime/approvalExpiryConvergence.test.ts`）；
 * - 两种情形清掉该标记（否则列表徽标挂错）：① **用户重新发言**（新一轮开始）；
 *   ② 本轮**新进入** `requires_action`（有了可回复的新卡，「上次已过期」不再是最新事实）。
 *
 * 这里只驱动公开的 `syncStateForMessage`（`addAndPersistMessage` 的落盘链路与本用例无关）。
 */
import { describe, expect, it } from 'bun:test';
import { ChatMessagePersistence } from '../../src/chat/manager/messagePersistence';
import { TRANSIENT_AWAITING_APPROVAL } from '../../src/chat/services/ToolExecutionService';
import type { ChatSession } from '@modules/session/types/session';
import { DataSessionStatus } from '@modules/session/types/session';
import type { Message } from '@modules/session/types/message.js';

interface StoredSession {
  id: string;
  status?: string;
  metadata: { approvalExpiredAt?: number; approvalExpiredInboxId?: string };
}

/** 最小 deps：`syncConversationState` 只用到 `chatSessions` 与 `sessionGateway` */
function makePersistence(stored: StoredSession) {
  const updates: StoredSession[] = [];
  const deps = {
    chatSessions: new Map<string, ChatSession>(),
    sessionGateway: {
      getSession: async (id: string) => (id === stored.id ? stored : null),
      updateSession: async (session: StoredSession) => {
        updates.push({ ...session, metadata: { ...session.metadata } });
        Object.assign(stored, session);
      },
    },
    getOrCreateEventLog: () => {
      throw new Error('unused');
    },
    rebuildToolCallSeqMap: async () => {},
    toolCallSeqMap: new Map<string, number>(),
    requestReconcile: () => {},
    pendingPersistPromises: new Set<Promise<void>>(),
    createAssistantMessage: () => {
      throw new Error('unused');
    },
    getStreamTailSeq: async () => 0,
  };
  return {
    persistence: new ChatMessagePersistence(
      deps as unknown as ConstructorParameters<typeof ChatMessagePersistence>[0]
    ),
    deps,
    updates,
  };
}

function makeSession(metadata: StoredSession['metadata']): ChatSession {
  return {
    id: 'sess-expired',
    state: DataSessionStatus.ACTIVE,
    metadata,
    messages: [],
  } as unknown as ChatSession;
}

const userMessage = { role: 'user' } as Message;

/** 等一轮宏任务，让 syncConversationState 的异步落盘完成 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('审批已过期标记：用户重新发言即清除', () => {
  it('内存与持久化两侧都清掉 approvalExpiredAt / approvalExpiredInboxId', async () => {
    const stored: StoredSession = {
      id: 'sess-expired',
      status: 'active',
      metadata: { approvalExpiredAt: 123, approvalExpiredInboxId: 'inbox-1' },
    };
    const { persistence, deps, updates } = makePersistence(stored);
    const session = makeSession({
      approvalExpiredAt: 123,
      approvalExpiredInboxId: 'inbox-1',
    });
    deps.chatSessions.set(session.id, session);

    persistence.syncStateForMessage(session.id, userMessage);
    await flush();

    expect(
      (session.metadata as { approvalExpiredAt?: number }).approvalExpiredAt
    ).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(stored.metadata.approvalExpiredAt).toBeUndefined();
    expect(stored.metadata.approvalExpiredInboxId).toBeUndefined();
  });

  it('没有标记 ⇒ 不产生多余落盘（幂等 / 零噪音）', async () => {
    const stored: StoredSession = {
      id: 'sess-expired',
      status: 'active',
      metadata: {},
    };
    const { persistence, deps, updates } = makePersistence(stored);
    const session = makeSession({});
    deps.chatSessions.set(session.id, session);

    persistence.syncStateForMessage(session.id, userMessage);
    await flush();

    expect(updates).toHaveLength(0);
  });

  it('本轮新进入 requires_action（有了新卡）⇒ 旧过期标记同样清除', async () => {
    const stored: StoredSession = {
      id: 'sess-expired',
      status: 'active',
      metadata: { approvalExpiredAt: 123, approvalExpiredInboxId: 'inbox-1' },
    };
    const { persistence, deps, updates } = makePersistence(stored);
    const session = makeSession({
      approvalExpiredAt: 123,
      approvalExpiredInboxId: 'inbox-1',
    });
    deps.chatSessions.set(session.id, session);

    persistence.syncStateForMessage(session.id, {
      role: 'assistant',
      metadata: { terminationReason: TRANSIENT_AWAITING_APPROVAL },
    } as unknown as Message);
    await flush();

    expect(updates).toHaveLength(1);
    expect(stored.status).toBe('requires_action');
    expect(stored.metadata.approvalExpiredAt).toBeUndefined();
  });
});
