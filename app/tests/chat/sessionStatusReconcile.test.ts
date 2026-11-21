// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-21：**陈旧崩溃徽标对账** + 轮次闭合判定 回归锁。
 *
 * 实证：本机 52 paused / 4 error，逐个核 `events.jsonl` 后最后一个 turn 均已闭合。
 * 契约：只有「带崩溃恢复标记 + 轮次已闭合」的会话才收回，且按**同一套收尾原因口径**：
 * 正常收尾 ⇒ active、等待审批 ⇒ requires_action；失败/可续原因与"仍在飞"一律保持原状。
 */

import { describe, expect, it } from 'bun:test';
import {
  classifyTurnTail,
  createTurnOpenProbe,
  reconcileInterruptedSessionStatuses,
} from '../../src/chat/manager/sessionStatusReconcile';
import { SessionStatus } from '@modules/session/types/UnifiedSession';
import type { EventLogStorage, SessionGateway } from '@modules/session';
import type { UnifiedSession } from '@modules/session/types/UnifiedSession';

function makeSession(
  id: string,
  status: SessionStatus,
  metadata: Record<string, unknown>
): UnifiedSession {
  return {
    id,
    type: 'local' as never,
    title: id,
    createdAt: 1000,
    updatedAt: 2000,
    lastActivityAt: 2000,
    status,
    metadata,
  } as UnifiedSession;
}

function fakeLog(
  events: Array<{ type: string; data?: unknown }>
): EventLogStorage {
  return {
    async getTailSeq() {
      return events.length;
    },
    async read() {
      return events as never;
    },
  } as unknown as EventLogStorage;
}

function fakeGateway(sessions: UnifiedSession[]) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const gateway = {
    async listSessions() {
      return [...byId.values()].map((s) => ({ ...s }));
    },
    async updateSession(session: UnifiedSession) {
      byId.set(session.id, session);
    },
  } as unknown as Pick<SessionGateway, 'listSessions' | 'updateSession'>;
  return { gateway, byId };
}

const closedCompleted = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'assistant/text', data: { content: 'ok' } },
  {
    type: 'turn/end',
    data: { turn: 1, finishReason: 'stop', terminationReason: 'completed' },
  },
];

describe('classifyTurnTail：轮次闭合判定', () => {
  it('真实 turn/end ⇒ 已闭合并带回收尾原因', () => {
    expect(classifyTurnTail(closedCompleted)).toEqual({
      open: false,
      hasTurn: true,
      finishReason: 'stop',
      terminationReason: 'completed',
    });
  });

  it('最后是 turn/start ⇒ 未闭合', () => {
    expect(
      classifyTurnTail([{ type: 'turn/start', data: { turn: 2 } }]).open
    ).toBe(true);
  });

  it('合成 closer（synthetic=true）⇒ 视为未闭合（该轮实为中断）', () => {
    expect(
      classifyTurnTail([
        { type: 'turn/start', data: { turn: 1 } },
        {
          type: 'turn/end',
          data: { turn: 1, finishReason: 'canceled', synthetic: true },
        },
      ]).open
    ).toBe(true);
  });

  it('无 turn 事件 ⇒ 不算未闭合（旧会话）', () => {
    expect(classifyTurnTail([])).toEqual({ open: false, hasTurn: false });
  });
});

describe('createTurnOpenProbe', () => {
  it('尾部读不到 turn 事件 ⇒ false（无未闭合轮）', async () => {
    const probe = createTurnOpenProbe(() => fakeLog([]));
    expect(await probe('s')).toBe(false);
  });

  it('尾部是 turn/start ⇒ true', async () => {
    const probe = createTurnOpenProbe(() =>
      fakeLog([{ type: 'turn/start', data: { turn: 3 } }])
    );
    expect(await probe('s')).toBe(true);
  });
});

describe('reconcileInterruptedSessionStatuses：陈旧徽标对账', () => {
  it('paused + recovered_paused + 轮次已闭合（completed）⇒ active 并清崩溃痕迹', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s1', SessionStatus.PAUSED, {
        crashRecovery: 'recovered_paused',
        crashedAt: '123',
        lastActivityBeforeCrash: '100',
      }),
    ]);
    const stats = await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () => fakeLog(closedCompleted),
    });

    const saved = byId.get('s1');
    expect(saved?.status).toBe(SessionStatus.ACTIVE);
    expect(saved?.metadata?.crashRecovery).toBeUndefined();
    expect(saved?.metadata?.crashedAt).toBeUndefined();
    expect(saved?.metadata?.lastActivityBeforeCrash).toBeUndefined();
    expect(saved?.metadata?.statusReconcile).toBe('closed_turn_cleared');
    expect(stats.reconciled).toBe(1);
  });

  it('error + failed_stale + 轮次已闭合（completed）⇒ active', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s2', SessionStatus.ERROR, { crashRecovery: 'failed_stale' }),
    ]);
    await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () => fakeLog(closedCompleted),
    });
    expect(byId.get('s2')?.status).toBe(SessionStatus.ACTIVE);
  });

  it('轮次已闭合但收尾是 awaiting_approval ⇒ requires_action（不误收为 active）', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s3', SessionStatus.PAUSED, {
        crashRecovery: 'recovered_paused',
      }),
    ]);
    await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () =>
        fakeLog([
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'turn/end',
            data: {
              turn: 1,
              finishReason: 'tool_use',
              terminationReason: 'awaiting_approval',
            },
          },
        ]),
    });
    expect(byId.get('s3')?.status).toBe(SessionStatus.REQUIRES_ACTION);
  });

  it('轮次仍在飞 ⇒ 原状保留（不收回）', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s4', SessionStatus.PAUSED, {
        crashRecovery: 'recovered_paused',
      }),
    ]);
    const stats = await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () =>
        fakeLog([{ type: 'turn/start', data: { turn: 9 } }]),
    });
    expect(byId.get('s4')?.status).toBe(SessionStatus.PAUSED);
    expect(stats.reconciled).toBe(0);
    expect(stats.kept).toBe(1);
  });

  it('可续中断原因（timeout）⇒ 保持 paused（徽标本就如实）', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s5', SessionStatus.PAUSED, {
        crashRecovery: 'recovered_paused',
      }),
    ]);
    await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () =>
        fakeLog([
          { type: 'turn/end', data: { turn: 1, terminationReason: 'timeout' } },
        ]),
    });
    expect(byId.get('s5')?.status).toBe(SessionStatus.PAUSED);
  });

  it('旧会话（无 turn 事件）⇒ 与探针同判"不算被中断"，收回 active', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s8', SessionStatus.PAUSED, {
        crashRecovery: 'recovered_paused',
      }),
    ]);
    await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () => fakeLog([]),
    });
    expect(byId.get('s8')?.status).toBe(SessionStatus.ACTIVE);
  });

  it('合成 closer（崩溃补写）⇒ 保留原状（真中断）', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s9', SessionStatus.PAUSED, {
        crashRecovery: 'recovered_paused',
      }),
    ]);
    await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () =>
        fakeLog([
          { type: 'turn/start', data: { turn: 1 } },
          {
            type: 'turn/end',
            data: { turn: 1, finishReason: 'canceled', synthetic: true },
          },
        ]),
    });
    expect(byId.get('s9')?.status).toBe(SessionStatus.PAUSED);
  });

  it('没有崩溃标记的 paused/error ⇒ 不参与对账（避免误伤运行期语义）', async () => {
    const { gateway, byId } = fakeGateway([
      makeSession('s6', SessionStatus.PAUSED, {}),
      makeSession('s7', SessionStatus.ERROR, { crashRecovery: 'resumed' }),
    ]);
    const stats = await reconcileInterruptedSessionStatuses({
      gateway,
      getOrCreateEventLog: () => fakeLog(closedCompleted),
    });
    expect(byId.get('s6')?.status).toBe(SessionStatus.PAUSED);
    expect(byId.get('s7')?.status).toBe(SessionStatus.ERROR);
    expect(stats.reconciled).toBe(0);
  });
});
