/**
 * P2-10（2026-09-25）：**统一预算策略层**（`.trae/specs/budget-policy-layer.md`）。
 *
 * 覆盖 spec §6：注册表（id 唯一 / 重复跳或抛 / 未注册抛错）、`context` 阈值边界、
 * `goal` 触顶、`subagent` 夹取区间。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  registerBudgetPolicy,
  listBudgetPolicies,
  getBudgetPolicy,
  resetBudgetPolicies,
  evaluateContextBudget,
  evaluateGoalBudget,
  evaluateSummaryCharBudget,
  TokenBudgetStatus,
  UNIFIED_THRESHOLDS,
  SUMMARY_MIN_CHARS,
  SUMMARY_HARD_MAX_CHARS,
  type ContextBudgetInput,
  type GoalBudgetInput,
  type SummaryBudgetInput,
} from '../../src/core/tokenBudget/BudgetPolicy';

beforeEach(() => {
  resetBudgetPolicies();
});

afterEach(() => {
  resetBudgetPolicies();
});

describe('P2-10 策略注册表', () => {
  test('未注册 id ⇒ getBudgetPolicy 抛错（不静默回退）', () => {
    expect(() => getBudgetPolicy('not.registered')).toThrow(/未注册的预算策略/);
  });

  test('同 id + 同 scope 的重复注册 ⇒ 幂等跳过（模块重复加载不抛）', () => {
    const policy = {
      id: 'demo.1',
      scope: 'context' as const,
      description: 'x',
      evaluate: () => ({
        scope: 'context' as const,
        budget: 1,
        status: TokenBudgetStatus.NORMAL,
      }),
    };
    registerBudgetPolicy(policy);
    expect(() => registerBudgetPolicy(policy)).not.toThrow();
    expect(listBudgetPolicies()).toHaveLength(1);
  });

  test('同 id 不同 scope ⇒ 抛错（真实冲突，fail-closed）', () => {
    registerBudgetPolicy({
      id: 'demo.1',
      scope: 'context',
      description: 'x',
      evaluate: () => ({
        scope: 'context' as const,
        budget: 1,
        status: TokenBudgetStatus.NORMAL,
      }),
    });
    expect(() =>
      registerBudgetPolicy({
        id: 'demo.1',
        scope: 'goal',
        description: 'y',
        evaluate: () => ({
          scope: 'goal' as const,
          budget: 1,
          status: TokenBudgetStatus.NORMAL,
        }),
      })
    ).toThrow(/id 冲突/);
  });

  test('缺少 id / scope ⇒ 抛错', () => {
    expect(() =>
      registerBudgetPolicy({
        id: '',
        scope: 'context',
        description: 'x',
        evaluate: () => ({
          scope: 'context' as const,
          budget: 1,
          status: TokenBudgetStatus.NORMAL,
        }),
      })
    ).toThrow(/缺少必填字段/);
  });
});

describe('P2-10 context.compression-levels（阈值边界）', () => {
  const evalAt = (ratio: number): TokenBudgetStatus => {
    const input: ContextBudgetInput = {
      currentTokens: ratio * 100,
      maxTokens: 100,
    };
    return evaluateContextBudget(input).status;
  };

  test('阈值分档与 UNIFIED_THRESHOLDS 一致', () => {
    expect(evalAt(0)).toBe(TokenBudgetStatus.NORMAL);
    expect(evalAt(0.49)).toBe(TokenBudgetStatus.NORMAL);
    expect(evalAt(0.5)).toBe(TokenBudgetStatus.NORMAL); // 0.5 仅影响压缩级，不改状态
    expect(evalAt(0.7)).toBe(TokenBudgetStatus.NORMAL);
    expect(evalAt(UNIFIED_THRESHOLDS.WARNING - 0.01)).toBe(
      TokenBudgetStatus.NORMAL
    );
    expect(evalAt(UNIFIED_THRESHOLDS.WARNING)).toBe(TokenBudgetStatus.WARNING);
    expect(evalAt(0.85)).toBe(TokenBudgetStatus.WARNING);
    expect(evalAt(UNIFIED_THRESHOLDS.CRITICAL)).toBe(
      TokenBudgetStatus.CRITICAL
    );
    expect(evalAt(1)).toBe(TokenBudgetStatus.EXCEEDED);
  });

  test('maxTokens 非正 ⇒ ratio undefined（不臆造用量比）', () => {
    const out = evaluateContextBudget({ currentTokens: 10, maxTokens: 0 });
    expect(out.ratio).toBeUndefined();
    expect(out.status).toBe(TokenBudgetStatus.NORMAL);
    expect(out.budget).toBe(0);
  });
});

describe('P2-10 goal.limit（触顶判定）', () => {
  test('tokensUsed >= tokenBudget ⇒ EXCEEDED；相等即触顶（与原内联判定等价）', () => {
    expect(
      evaluateGoalBudget({ tokensUsed: 100, tokenBudget: 100 }).status
    ).toBe(TokenBudgetStatus.EXCEEDED);
    expect(
      evaluateGoalBudget({ tokensUsed: 99, tokenBudget: 100 }).status
    ).toBe(TokenBudgetStatus.NORMAL);
    expect(
      evaluateGoalBudget({ tokensUsed: 101, tokenBudget: 100 }).status
    ).toBe(TokenBudgetStatus.EXCEEDED);
  });

  test('未设预算 ⇒ 语义"不限"（NORMAL + ratio undefined + budget = Infinity）', () => {
    const out = evaluateGoalBudget({ tokensUsed: 999999 });
    expect(out.status).toBe(TokenBudgetStatus.NORMAL);
    expect(out.ratio).toBeUndefined();
    expect(out.budget).toBe(Number.POSITIVE_INFINITY);
  });

  test('ratio 按预算折算', () => {
    const out: ReturnType<typeof evaluateGoalBudget> = evaluateGoalBudget({
      tokensUsed: 25,
      tokenBudget: 100,
    });
    expect(out.ratio).toBe(0.25);
  });
});

describe('P2-10 subagent.summary-chars（夹取区间）', () => {
  test('未知输入 ⇒ 退化下限（不臆测）', () => {
    expect(evaluateSummaryCharBudget({ workerCount: 1 })).toBe(
      SUMMARY_MIN_CHARS
    );
    expect(
      evaluateSummaryCharBudget({ contextWindow: 1000, workerCount: 1 })
    ).toBe(SUMMARY_MIN_CHARS);
    expect(
      evaluateSummaryCharBudget({
        parentPromptTokens: 0,
        contextWindow: 1000,
        workerCount: 0,
      })
    ).toBe(SUMMARY_MIN_CHARS);
  });

  test('中间值按 50% ÷ worker 数 × chars/token 计算', () => {
    expect(
      evaluateSummaryCharBudget({
        parentPromptTokens: 0,
        contextWindow: 10000,
        workerCount: 1,
      })
    ).toBe(17500);
    expect(
      evaluateSummaryCharBudget({
        parentPromptTokens: 0,
        contextWindow: 10000,
        workerCount: 4,
      })
    ).toBe(4375);
    expect(
      evaluateSummaryCharBudget({
        parentPromptTokens: 0,
        contextWindow: 10000,
        workerCount: 1,
        charsPerToken: 2,
      })
    ).toBe(10000);
  });

  test('极大余量 ⇒ 夹到硬顶', () => {
    expect(
      evaluateSummaryCharBudget({
        parentPromptTokens: 0,
        contextWindow: 100000,
        workerCount: 1,
      })
    ).toBe(SUMMARY_HARD_MAX_CHARS);
  });
});
