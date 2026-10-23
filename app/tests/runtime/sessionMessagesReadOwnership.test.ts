/**
 * 多租户 P3 续（2026-10-23）：`SessionMessagesRead` 的**显式归属校验**
 *
 * 背景：三条事件派生读取（`getSessionMessages` / `getSessionEvents` /
 * `verifySessionDerivation`）此前只靠存储分区兜底，没有归属判定。本用例锁定：
 *  ① 他人会话 ⇒ 三条读取均拒绝（空结果 / `available:false`），且**不触达事件日志**；
 *  ② 归属者本人 ⇒ 正常进入读取（零行为变更）；
 *  ③ 本地身份（桌面 / CLI）⇒ 恒放行；
 *  ④ 会话不存在 ⇒ 保持既有"空结果"语义，不伪装成越权。
 */
import { describe, it, expect } from 'bun:test';

import { SessionMessagesRead } from '../../src/runtime/api/sessionMessagesRead.js';
import type { EventLogStorage } from '@modules/session';
import type { ChatManager } from '@modules/chat';
import type { SessionManager } from '../../src/session/types/session.js';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';

const SID = 'session_owner_read_test';
const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

function makeSubject(opts: {
  owner?: { tenantId: string; userId: string };
  sessionExists?: boolean;
  eventLogExists?: boolean;
  onEventLogRead?: () => void;
}): SessionMessagesRead {
  const session =
    opts.sessionExists === false
      ? undefined
      : ({
          id: SID,
          metadata: opts.owner
            ? { title: 't', owner: opts.owner }
            : { title: 't' },
        } as unknown);

  const eventLog = {
    exists: () => opts.eventLogExists ?? false,
    getTailSeq: async () => 0,
    read: async () => {
      opts.onEventLogRead?.();
      return [];
    },
  } as unknown as EventLogStorage;

  const chatManager = {
    _getOrCreateEventLog: () => eventLog,
    getSessionGateway: () => ({
      getSession: async () =>
        opts.sessionExists === false
          ? null
          : {
              id: SID,
              metadata: session
                ? (session as { metadata: unknown }).metadata
                : {},
            },
      getMessages: async () => [],
    }),
  };

  return new SessionMessagesRead({
    getChatManager: () => chatManager as unknown as ChatManager,
    getSessionManager: () =>
      ({ getSession: () => session }) as unknown as SessionManager,
    getFilterDeletedRanges: () => (_sid, msgs) => msgs,
  });
}

describe('SessionMessagesRead 归属校验（多租户 P3 续）', () => {
  it('他人会话 ⇒ 三条读取均拒绝，且不触达事件日志', async () => {
    let readCalls = 0;
    const subject = makeSubject({
      owner: { tenantId: 'acme', userId: 'alice' },
      eventLogExists: true,
      onEventLogRead: () => {
        readCalls += 1;
      },
    });

    const messages = await runWithPrincipal(BOB, () =>
      subject.getSessionMessages(SID)
    );
    const events = await runWithPrincipal(BOB, () =>
      subject.getSessionEvents(SID)
    );
    const verify = await runWithPrincipal(BOB, () =>
      subject.verifySessionDerivation(SID)
    );

    expect(messages).toEqual({ messages: [], hasMore: false });
    expect(events).toEqual({
      events: [],
      tailSeq: 0,
      hasEarlier: false,
      hasMore: false,
    });
    expect(verify.available).toBe(false);
    expect(verify.reason).toContain('归属');
    expect(readCalls).toBe(0);
  });

  it('归属者本人 ⇒ 正常进入读取（不再被守卫拦截）', async () => {
    const subject = makeSubject({
      owner: { tenantId: 'acme', userId: 'alice' },
      eventLogExists: true,
    });

    const verify = await runWithPrincipal(ALICE, () =>
      subject.verifySessionDerivation(SID)
    );

    // 空事件日志 ⇒ 走到原有「无 v1 事件」分支（而非归属拒绝）
    expect(verify.available).toBe(false);
    expect(verify.reason).toContain('v1');
  });

  it('本地身份 ⇒ 恒放行（桌面 / CLI 零行为变更）', async () => {
    const subject = makeSubject({
      owner: { tenantId: 'acme', userId: 'alice' },
      eventLogExists: true,
    });

    const verify = await subject.verifySessionDerivation(SID);
    expect(verify.available).toBe(false);
    expect(verify.reason).toContain('v1');
  });

  it('会话不存在 ⇒ 保持"空结果"语义，不伪装成越权', async () => {
    const subject = makeSubject({ sessionExists: false });

    const messages = await subject.getSessionMessages(SID);
    const verify = await subject.verifySessionDerivation(SID);

    expect(messages).toEqual({ messages: [], hasMore: false });
    expect(verify.available).toBe(false);
    expect(verify.reason).toContain('无事件日志');
  });
});
