/**
 * 2026-11-19（H1 补漏）：`getSessionMessages` 必须**同时透传** `firstEventSeq` 与 `lastEventSeq`。
 *
 * 背景：H1（`2ed22fa22`）把派生排序键与分页游标切到「首事件 seq」，但读路径的响应映射
 * 当时只复制了 `lastEventSeq` ⇒ 前端游标退回末事件 seq（比排序键大），下一页边界前移、
 * 「加载更早」原地打转。本用例从**返回体**与**分页过滤**两侧钉死这条契约。
 */
import { describe, it, expect } from 'bun:test';

import { SessionMessagesRead } from '@openliri/service/runtime/api/sessionMessagesRead';
import type { EventLogStorage } from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events.js';
import type { ChatManager } from '@modules/chat';
import type { SessionManager } from '@modules/session/types/session.js';

const SID = 'session_seq_passthrough_test';

function ev(
  seq: number,
  type: string,
  data: Record<string, unknown>
): LiriEvent {
  return { type, seq, time: seq, sessionId: SID, data } as unknown as LiriEvent;
}

function makeSubject(events: LiriEvent[]): SessionMessagesRead {
  const eventLog = {
    exists: () => true,
    getTailSeq: async () => events.at(-1)?.seq ?? 0,
    read: async () => events,
  } as unknown as EventLogStorage;
  const chatManager = {
    _getOrCreateEventLog: () => eventLog,
    // 无投影 ⇒ 纯事件派生（不受 messages.jsonl 覆盖）
    getSessionGateway: () => ({ getMessages: async () => [] }),
  };
  return new SessionMessagesRead({
    getChatManager: () => chatManager as unknown as ChatManager,
    getSessionManager: () =>
      ({ getSession: () => undefined }) as unknown as SessionManager,
    getFilterDeletedRanges: () => (_sid, msgs) => msgs,
  });
}

/** u1 首事件 3；a1 首事件 9、末事件 20（首末不同，才能区分两个键） */
const EVENTS: LiriEvent[] = [
  ev(3, 'user/message', { content: '问题', messageId: 'u1' }),
  ev(9, 'assistant/text', { content: '第一段', messageId: 'a1' }),
  ev(20, 'assistant/text', { content: '第二段', messageId: 'a1' }),
];

describe('getSessionMessages 的 seq 透传（H1 补漏）', () => {
  it('首/末两键都如实返回（前端游标才有 firstEventSeq 可用）', async () => {
    const result = await makeSubject(EVENTS).getSessionMessages(SID);
    const a1 = result.messages.find((m) => m.id === 'a1');
    expect(a1?.firstEventSeq).toBe(9);
    expect(a1?.lastEventSeq).toBe(20);
    const u1 = result.messages.find((m) => m.id === 'u1');
    expect(u1?.firstEventSeq).toBe(3);
  });

  it('分页 before 按首事件 seq 过滤：before=12 仍应包含首键 9 的消息', async () => {
    // 若退回末事件 seq（20）过滤，a1 会被排除 ⇒ 本页只剩 u1（"翻不到"）。
    // 页首按既有"不切半轮"规则对齐到轮首 u1，故整页为 [u1, a1]（此时 hasMore 由对齐后的页首决定）。
    const result = await makeSubject(EVENTS).getSessionMessages(SID, {
      limit: 1,
      before: 12,
    });
    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});
