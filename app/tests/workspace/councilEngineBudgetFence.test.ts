/**
 * G-02（2026-10-19）：Council 轮次级 in-flight 熔断。
 *
 * 契约：
 *  ① 每轮开始前复核预算；越界 ⇒ runDebate 立即终止，后续轮次不再发起发言；
 *  ② 预算越界错误**穿透**「逐 Agent try/catch」—— 不得降级成"该 Agent 跳过"后继续调用。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { CouncilEngine } from '../../src/workspace/CouncilEngine';
import type { CouncilAgentRole } from '../../src/workspace/CouncilTypes';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

const SID = 'sess-council-fence';
const agents: CouncilAgentRole[] = [
  { agentId: 'a1', name: 'A1', expertise: [], weight: 1 },
];

function makeSession(engine: CouncilEngine, maxRounds: number): string {
  return engine.createSession('ws', 'topic', 'ctx', agents, {
    maxRounds,
    ownerSessionId: SID,
  }).sessionId;
}

const consensus = async () => ({
  result: 'unanimous' as const,
  finalProposal: 'ok',
  minorityOpinion: null,
});

function budgetError(): AppError {
  return new AppError(
    'budget exceeded',
    ErrorCategory.RESOURCE,
    ErrorSeverity.MEDIUM,
    'DAILY_BUDGET_EXCEEDED'
  );
}

describe('G-02：Council 轮次级预算熔断', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('开局即越界 ⇒ 第一轮就不发起发言', async () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(1);
    budget.recordUsdUsage(2);

    const engine = new CouncilEngine(() => {});
    const sid = makeSession(engine, 2);
    let statements = 0;

    await expect(
      engine.runDebate(
        sid,
        async () => {
          statements++;
          return { content: 'x', keyPoints: [] };
        },
        consensus
      )
    ).rejects.toMatchObject({ code: 'DAILY_BUDGET_EXCEEDED' });

    expect(statements).toBe(0);
  });

  it('中途越界 ⇒ 后续轮次不再发起发言', async () => {
    const engine = new CouncilEngine(() => {});
    const sid = makeSession(engine, 2);
    let statements = 0;

    await expect(
      engine.runDebate(
        sid,
        async () => {
          statements++;
          // 第一轮首条发言后把额度用尽 ⇒ 第二轮前置检查必须拦住
          const budget = getDailyBudget();
          budget.setLimitUsd(1);
          budget.recordUsdUsage(2);
          return { content: 'x', keyPoints: [] };
        },
        consensus
      )
    ).rejects.toMatchObject({ code: 'DAILY_BUDGET_EXCEEDED' });

    expect(statements).toBe(1);
  });

  it('发言回调抛预算错误 ⇒ 穿透逐 Agent catch（不降级为占位发言）', async () => {
    const engine = new CouncilEngine(() => {});
    const sid = engine.createSession(
      'ws',
      'topic-3',
      'ctx',
      [
        { agentId: 'a1', name: 'A1', expertise: [], weight: 1 },
        { agentId: 'a2', name: 'A2', expertise: [], weight: 1 },
      ],
      { maxRounds: 1, ownerSessionId: SID }
    ).sessionId;
    let statements = 0;

    await expect(
      engine.runDebate(
        sid,
        async () => {
          statements++;
          throw budgetError();
        },
        consensus
      )
    ).rejects.toMatchObject({ code: 'DAILY_BUDGET_EXCEEDED' });

    // 不得继续尝试第二个 Agent
    expect(statements).toBe(1);
  });
});
