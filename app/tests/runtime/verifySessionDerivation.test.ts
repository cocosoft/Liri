// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1-15（2026-10-05）：`SessionMessagesRead.verifySessionDerivation` 首个测试。
 *
 * 背景：`recovery-orchestration` spec 遗留项「`verifySessionDerivation` 无任何测试」
 * （它是 `CoreAPI` 契约的一部分，仅由 `implements` 必需、无其它生产消费者）。
 *
 * 覆盖三个分支（注入假 deps，不触真盘）：
 *   A 无事件日志 ⇒ `available:false`（"无法校验"，**不是"一致"**）
 *   B 有日志但无 v1（messageId）事件 ⇒ `available:false`
 *   C 有 v1 事件 ⇒ `available:true` + 返回事实差异报告（本方法不判错）
 */
import { describe, it, expect } from 'bun:test';
import { SessionMessagesRead } from '../../src/runtime/api/sessionMessagesRead.js';
import type { EventLogStorage } from '@modules/session';
import type { LiriEvent } from '../../src/session/types/events.js';
import type { ChatManager } from '@modules/chat';
import type { SessionManager } from '../../src/session/types/session.js';

const SID = 'session_verify_test';

/** 假事件日志：只实现 verifySessionDerivation 用到的 exists/getTailSeq/read */
function fakeEventLog(opts: {
  exists: boolean;
  events: LiriEvent[];
}): EventLogStorage {
  return {
    exists: () => opts.exists,
    getTailSeq: async () => opts.events.at(-1)?.seq ?? 0,
    read: async () => opts.events,
  } as unknown as EventLogStorage;
}

function ev(
  type: string,
  data: Record<string, unknown>,
  seq: number
): LiriEvent {
  return { type, seq, time: seq, sessionId: SID, data } as unknown as LiriEvent;
}

/** 造被测实例（假 chatManager/sessionManager，零真盘） */
function makeSubject(opts: {
  eventLog?: EventLogStorage;
  messages?: unknown[];
}): SessionMessagesRead {
  const chatManager = {
    _getOrCreateEventLog: () => opts.eventLog,
    getSessionGateway: () => ({
      getMessages: async () => opts.messages ?? [],
    }),
  };
  const sessionManager = { getSession: () => undefined };
  return new SessionMessagesRead({
    getChatManager: () => chatManager as unknown as ChatManager,
    getSessionManager: () => sessionManager as unknown as SessionManager,
    // 删除墓碑过滤：本用例不涉及 ⇒ 恒等函数
    getFilterDeletedRanges: () => (sid, msgs) => msgs,
  });
}

describe('SessionMessagesRead.verifySessionDerivation（P1-15）', () => {
  it('A 无事件日志 ⇒ available:false（"无法校验"≠"一致"）', async () => {
    const subject = makeSubject({
      eventLog: fakeEventLog({ exists: false, events: [] }),
    });
    const r = await subject.verifySessionDerivation(SID);
    expect(r.available).toBe(false);
    expect(r.diff).toBeUndefined();
    expect(r.reason).toContain('无事件日志');
  });

  it('B 有日志但无 v1（messageId）事件 ⇒ available:false', async () => {
    const subject = makeSubject({
      eventLog: fakeEventLog({
        exists: true,
        events: [
          ev('turn/start', { turn: 1 }, 1),
          // 无 messageId ⇒ 不满足 v1 判据
          ev('assistant/text', { content: 'hi' }, 2),
        ],
      }),
    });
    const r = await subject.verifySessionDerivation(SID);
    expect(r.available).toBe(false);
    expect(r.reason).toContain('无 v1');
  });

  it('C 有 v1 事件 ⇒ available:true 且返回差异报告（本方法不判错）', async () => {
    const subject = makeSubject({
      eventLog: fakeEventLog({
        exists: true,
        events: [
          ev('turn/start', { turn: 1 }, 1),
          ev('user/message', { content: 'hi', messageId: 'm1' }, 2),
        ],
      }),
      messages: [],
    });
    const r = await subject.verifySessionDerivation(SID);
    expect(r.available).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.diff).toBeDefined();
  });
});
