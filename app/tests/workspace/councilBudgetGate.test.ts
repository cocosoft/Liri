/**
 * G-01（2026-10-19）：理事会（非 chat 管线）预算判定与记账。
 *
 * 修复前：`CouncilOrchestrator.callAI` 直调 `aiService.generate`，全文件无
 * `checkDailyBudget` / `recordDailyBudgetFromUsage` ⇒ 辩论轮次既不进账本也不被拦截。
 *
 * 契约：
 *  ① 额度耗尽 ⇒ **不发起任何模型调用**，抛既有 `DAILY_BUDGET_EXCEEDED`；
 *  ② 放行 ⇒ provider 回显的 usage 进入日账本（与 chat 同一计账助手）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { AIService } from '@modules/ai';
import { setAIServiceForTest } from '../../src/ai/services/aiService';
import { CouncilEngine } from '../../src/workspace/CouncilEngine';
import { CouncilOrchestrator } from '../../src/workspace/CouncilOrchestrator';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

const SID = 'sess-council-budget';
const agents = [{ agentId: 'a1', name: 'A1', expertise: [], weight: 1 }];

function makeOrchestrator(): CouncilOrchestrator {
  return new CouncilOrchestrator(new CouncilEngine(() => {}));
}

function lockBudget(): void {
  const budget = getDailyBudget();
  budget.setLimitUsd(1);
  budget.recordUsdUsage(2);
}

function fakeResponse(content: string) {
  return {
    id: 'ai_test',
    model: 'fake-model',
    content,
    usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
    timestamp: Date.now(),
  };
}

describe('G-01：Council 预算判定与记账', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    setAIServiceForTest(undefined);
  });

  it('额度耗尽 ⇒ 不发起任何模型调用（DAILY_BUDGET_EXCEEDED）', async () => {
    lockBudget();
    let calls = 0;
    setAIServiceForTest({
      generate: async () => {
        calls++;
        return fakeResponse('{}');
      },
    } as unknown as AIService);

    await expect(
      makeOrchestrator().startCouncil('ws', 'topic', 'ctx', agents, {
        maxRounds: 2,
        ownerSessionId: SID,
      })
    ).rejects.toMatchObject({ code: 'DAILY_BUDGET_EXCEEDED' });

    expect(calls).toBe(0);
  });

  it('同一轮内第 2 个 Agent：首条发言耗尽额度 ⇒ 第二次调用被前置拦截', async () => {
    let calls = 0;
    setAIServiceForTest({
      generate: async () => {
        calls++;
        // 首条发言后额度耗尽（同一轮内的后续调用必须靠 G-01 的"每次调用前"判定拦住）
        if (calls === 1) lockBudget();
        return fakeResponse('{}');
      },
    } as unknown as AIService);

    await expect(
      makeOrchestrator().startCouncil(
        'ws',
        'topic-intra-round',
        'ctx',
        [
          { agentId: 'a1', name: 'A1', expertise: [], weight: 1 },
          { agentId: 'a2', name: 'A2', expertise: [], weight: 1 },
        ],
        { maxRounds: 1, ownerSessionId: SID }
      )
    ).rejects.toMatchObject({ code: 'DAILY_BUDGET_EXCEEDED' });

    expect(calls).toBe(1);
  });

  it('放行 ⇒ provider 回显 usage 进入日账本', async () => {
    const before = getDailyBudget().getMode().todayUsed;
    let calls = 0;
    setAIServiceForTest({
      generate: async () => {
        calls++;
        return fakeResponse('{"result":"unanimous","finalProposal":"ok"}');
      },
    } as unknown as AIService);

    await makeOrchestrator().startCouncil('ws', 'topic-2', 'ctx', agents, {
      maxRounds: 1,
      ownerSessionId: SID,
    });

    // 1 条发言 + 1 次共识判定 ⇒ 2 次调用 × 50 tokens
    expect(calls).toBe(2);
    expect(getDailyBudget().getMode().todayUsed).toBe(before + 100);
  });
});
