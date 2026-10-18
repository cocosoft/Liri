/**
 * H-2-R4（2026-10-18）：Council 编排事件必须携带 `agentRole`。
 *
 * 背景：`OrchestrationMetrics.byRole` 只认 `agentRole` / `role` 字段，而 Council 事件
 * 此前只带 `agentName` ⇒ 该维度恒空（H-2 残留「数据缺口」）。
 *
 * 本守卫直接跑**真实 `CouncilEngine.runDebate`**（发言/共识回调为本地替身），
 * 订阅事件总线断言 `COUNCIL_AGENT_SPEAKING` / `COUNCIL_AGENT_DELTA` 的载荷含
 * `agentRole === agentId`。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { OrchestrationEventType as E } from '@modules/types/orchestrationEvents';

import {
  globalEventBus,
  type EventSubscription,
} from '../../src/core/events/EventBus';
import { CouncilEngine } from '../../src/workspace/CouncilEngine';
import type { CouncilAgentRole } from '../../src/workspace/CouncilTypes';

const AGENTS: CouncilAgentRole[] = [
  { agentId: 'architect', name: 'Architect', expertise: ['design'], weight: 1 },
  { agentId: 'security', name: 'Security', expertise: ['safety'], weight: 1 },
];

let subs: EventSubscription[] = [];

afterEach(() => {
  for (const sub of subs) sub.unsubscribe();
  subs = [];
});

describe('H-2-R4 Council 事件 agentRole', () => {
  it('SPEAKING / DELTA 均携带 agentRole（= agentId）', async () => {
    const seen: Array<{ type: string; agentRole?: string }> = [];
    for (const type of [E.COUNCIL_AGENT_SPEAKING, E.COUNCIL_AGENT_DELTA]) {
      subs.push(
        globalEventBus.on(type, (payload: unknown) => {
          const p = payload as { agentRole?: string };
          seen.push({ type, agentRole: p.agentRole });
        })
      );
    }

    const engine = new CouncilEngine(() => {
      // 本用例只关心事件载荷，不关心流式 UI 事件
    });
    const session = engine.createSession('ws', 'topic', 'ctx', AGENTS, {
      maxRounds: 1,
    });

    await engine.runDebate(
      session.sessionId,
      async (agentId: string) => ({
        content: `statement-${agentId}`,
        keyPoints: [],
      }),
      async () => ({
        result: 'unanimous' as const,
        finalProposal: 'ok',
        minorityOpinion: null,
      })
    );

    const speaking = seen.filter((s) => s.type === E.COUNCIL_AGENT_SPEAKING);
    const delta = seen.filter((s) => s.type === E.COUNCIL_AGENT_DELTA);

    expect(speaking.map((s) => s.agentRole)).toEqual(['architect', 'security']);
    expect(delta.map((s) => s.agentRole)).toEqual(['architect', 'security']);
  });
});
