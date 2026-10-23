/**
 * H-2-R5（2026-10-18）：CouncilOrchestrator.runDebate 必须发布起止事件。
 *
 * 背景：生产 HTTP 入口（`POST /v1/workspaces/:id/council` → `runCouncilDebate`）
 * 走的是 `createSession` + `runDebate` 两步，而 `COUNCIL_START/END` 此前只在
 * `startCouncil` 里发布 ⇒ 生产入口在 `OrchestrationMetrics` 中只有
 * round/speaking/delta，无法计算 Council 链路 P50/P95。
 *
 * 本守卫用替身 engine 隔离 AI，仅断言事件总线上的起止事件及关联键。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { OrchestrationEventType as E } from '@modules/types/orchestrationEvents';

import {
  globalEventBus,
  type EventSubscription,
} from '@openliri/kernel/events/EventBus';
import type { CouncilEngine } from '../../src/workspace/CouncilEngine';
import { CouncilOrchestrator } from '../../src/workspace/CouncilOrchestrator';
import type { CouncilSession } from '../../src/workspace/CouncilTypes';

function fakeSession(): CouncilSession {
  return {
    sessionId: 'council-1',
    workspaceId: 'ws-1',
    topic: 'topic',
    context: 'context',
    agents: [
      { agentId: 'architect', name: 'Architect', expertise: [], weight: 1 },
      { agentId: 'security', name: 'Security', expertise: [], weight: 1 },
    ],
    statements: [],
    phase: 'completed',
    currentRound: 1,
    maxRounds: 1,
    result: 'unanimous',
    finalProposal: 'ok',
  } as unknown as CouncilSession;
}

let subs: EventSubscription[] = [];

afterEach(() => {
  for (const sub of subs) sub.unsubscribe();
  subs = [];
});

describe('H-2-R5 runDebate 起止事件', () => {
  it('发布 COUNCIL_START / COUNCIL_END（同一 sessionId）', async () => {
    const session = fakeSession();
    const payloads: Array<{ type: string; sessionId?: string }> = [];
    for (const type of [E.COUNCIL_START, E.COUNCIL_END]) {
      subs.push(
        globalEventBus.on(type, (payload: unknown) => {
          const p = payload as { sessionId?: string };
          payloads.push({ type, sessionId: p.sessionId });
        })
      );
    }

    const engine = {
      getSession: () => session,
      runDebate: async () => session,
    } as unknown as CouncilEngine;

    const result = await new CouncilOrchestrator(engine).runDebate(
      session.sessionId
    );

    expect(result).toBe(session);
    expect(payloads).toEqual([
      { type: E.COUNCIL_START, sessionId: 'council-1' },
      { type: E.COUNCIL_END, sessionId: 'council-1' },
    ]);
  });
});
