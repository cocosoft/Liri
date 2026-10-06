/**
 * U4 在线质量评估：`scoreTurn` / `isSuspicious` / `nextLowScoreStreak` 纯函数单测。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D1/D2 + §5（用例 1/2 及权重不变量）。
 *
 * ⚠️ 本文件同时**反向锁定两条边界**（末组用例）：
 *  ① **不消费** `BehaviorMetrics`（其契约"仅观测、不得作判据"）；② **不判正确性**（无 ground truth）。
 */
import { describe, expect, it } from 'bun:test';
import {
  WEIGHTS,
  SUSPICIOUS_SCORE_THRESHOLD,
  EVALUATOR_VERSION,
  TOOL_CALLS_SOFT_MAX,
  TOOL_CALLS_HARD_MAX,
  DURATION_HARD_MS,
  OUTPUT_TOKENS_HARD,
} from '../../src/evals/online/weights';
import {
  isSuspicious,
  nextLowScoreStreak,
  scoreTurn,
} from '../../src/evals/online/turnQuality';
import type { TurnQualitySignals } from '../../src/evals/online/types';

/** 构造一份"干净"的已完成轮（各分量满值） */
function signals(over: Partial<TurnQualitySignals> = {}): TurnQualitySignals {
  return {
    status: 'completed',
    toolCalls: 0,
    inputTokens: 1000,
    outputTokens: 500,
    ...over,
  };
}

describe('U4 weights：常量表不变量', () => {
  it('WEIGHTS 四项之和为 1（防止改权重时漏配导致分数整体缩放）', () => {
    const sum =
      WEIGHTS.completion + WEIGHTS.verdict + WEIGHTS.toolThrash + WEIGHTS.cost;
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe('U4 scoreTurn：不该评的情形', () => {
  it("status='running' ⇒ 返回 null（未终态不评）", () => {
    expect(scoreTurn(signals({ status: 'running' }))).toBeNull();
  });
});

describe('U4 scoreTurn：完成度单调 + 口径版本', () => {
  it('completed > aborted > error', () => {
    const c = scoreTurn(signals({ status: 'completed' }));
    const a = scoreTurn(signals({ status: 'aborted' }));
    const e = scoreTurn(signals({ status: 'error' }));
    expect(c).not.toBeNull();
    expect(a).not.toBeNull();
    expect(e).not.toBeNull();
    expect(c!.score).toBeGreaterThan(a!.score);
    expect(a!.score).toBeGreaterThan(e!.score);
    // 分量可解释
    expect(c!.components.completion).toBe(1);
    expect(a!.components.completion).toBe(0.5);
    expect(e!.components.completion).toBe(0);
    // 口径版本必带（分数可演进）
    expect(c!.evaluatorVersion).toBe(EVALUATOR_VERSION);
  });
});

describe('U4 scoreTurn：验证器结论分量', () => {
  it('APPROVE > 未知（中性）> ESCALATE > REJECT', () => {
    const approve = scoreTurn(
      signals({ verdict: { type: 'APPROVE', confidence: 0.9 } })
    )!;
    const unknown = scoreTurn(signals())!;
    const escalate = scoreTurn(
      signals({ verdict: { type: 'ESCALATE', confidence: 0.4 } })
    )!;
    const reject = scoreTurn(
      signals({ verdict: { type: 'REJECT', confidence: 0.8 } })
    )!;
    expect(approve.score).toBeGreaterThan(unknown.score);
    expect(unknown.score).toBeGreaterThan(escalate.score);
    expect(escalate.score).toBeGreaterThan(reject.score);
    // 未知 = 中点 ⇒ 不加不减
    expect(unknown.components.verdict).toBe(0.5);
  });
});

describe('U4 scoreTurn：工具反复度（只惩罚"明显过多"）', () => {
  it('软阈以内不扣；软→硬 线性衰减；达硬阈记 0', () => {
    expect(scoreTurn(signals({ toolCalls: 0 }))!.components.toolThrash).toBe(1);
    expect(
      scoreTurn(signals({ toolCalls: TOOL_CALLS_SOFT_MAX }))!.components
        .toolThrash
    ).toBe(1);
    expect(
      scoreTurn(
        signals({ toolCalls: (TOOL_CALLS_SOFT_MAX + TOOL_CALLS_HARD_MAX) / 2 })
      )!.components.toolThrash
    ).toBeCloseTo(0.5, 10);
    expect(
      scoreTurn(signals({ toolCalls: TOOL_CALLS_HARD_MAX }))!.components
        .toolThrash
    ).toBe(0);
  });
});

describe('U4 scoreTurn：代价软分量（未知不扣分）', () => {
  it('未给 durationMs ⇒ 时长侧不扣分（"没测到"≠"花很久"）', () => {
    expect(scoreTurn(signals({ durationMs: undefined }))!.components.cost).toBe(
      1
    );
  });

  it('时长与出参 token 双双达硬阈 ⇒ cost = 0', () => {
    const s = scoreTurn(
      signals({
        durationMs: DURATION_HARD_MS,
        outputTokens: OUTPUT_TOKENS_HARD,
      })
    )!;
    expect(s.components.cost).toBe(0);
  });
});

describe('U4 scoreTurn：分数恒在 [0,1]', () => {
  it('极端输入（巨量工具 + 巨量 token + 错误）不越界', () => {
    const s = scoreTurn(
      signals({
        status: 'error',
        toolCalls: 100_000,
        outputTokens: 10_000_000,
        durationMs: 100_000_000,
      })
    )!;
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
  });
});

describe('U4 isSuspicious：四条规则', () => {
  it('全不触发 ⇒ 不可疑', () => {
    const sig = signals({ verdict: { type: 'APPROVE', confidence: 0.9 } });
    const sc = scoreTurn(sig)!;
    expect(
      isSuspicious({ signals: sig, score: sc.score, consecutiveLowScores: 0 })
    ).toEqual({ suspicious: false, reasons: [] });
  });

  it('规则1 not-completed：error ⇒ 可疑', () => {
    const sig = signals({ status: 'error' });
    const v = isSuspicious({ signals: sig, score: 1, consecutiveLowScores: 0 });
    expect(v.suspicious).toBe(true);
    expect(v.reasons).toContain('not-completed');
  });

  it('规则2 verdict-negative：REJECT / ESCALATE ⇒ 可疑', () => {
    for (const type of ['REJECT', 'ESCALATE'] as const) {
      const sig = signals({ verdict: { type, confidence: 0.5 } });
      const v = isSuspicious({
        signals: sig,
        score: 1,
        consecutiveLowScores: 0,
      });
      expect(v.reasons).toContain('verdict-negative');
    }
  });

  it('规则3 low-score：分数低于阈值 ⇒ 可疑（且阈值边界为"小于"）', () => {
    const sig = signals({ status: 'error' });
    const sc = scoreTurn(sig)!; // error + 无 verdict ⇒ 恰好等于阈值
    const below = isSuspicious({
      signals: sig,
      score: SUSPICIOUS_SCORE_THRESHOLD - 0.01,
      consecutiveLowScores: 0,
    });
    expect(below.reasons).toContain('low-score');
    // 等于阈值 ⇒ 不算低分（避免边界抖动）
    const at = isSuspicious({
      signals: sig,
      score: SUSPICIOUS_SCORE_THRESHOLD,
      consecutiveLowScores: 0,
    });
    expect(at.reasons).not.toContain('low-score');
    expect(sc.score).toBeGreaterThanOrEqual(0);
  });

  it('规则4 low-score-streak：连续低分达轮数 ⇒ 可疑（可与其他原因叠加）', () => {
    const sig = signals({ status: 'error' });
    const v = isSuspicious({
      signals: sig,
      score: 0.1,
      consecutiveLowScores: 3,
    });
    expect(v.reasons).toEqual(
      expect.arrayContaining(['not-completed', 'low-score', 'low-score-streak'])
    );
  });
});

describe('U4 nextLowScoreStreak：纯函数计数', () => {
  it('低分累加；非低分归零', () => {
    expect(nextLowScoreStreak(0, false)).toBe(0);
    expect(nextLowScoreStreak(0, true)).toBe(1);
    expect(nextLowScoreStreak(2, true)).toBe(3);
    expect(nextLowScoreStreak(5, false)).toBe(0);
  });
});

describe('U4 边界反向锁定（不得回退）', () => {
  it('① 打分**不消费** BehaviorMetrics：输入契约里不存在该字段', () => {
    // 类型层已保证（TurnQualitySignals 无 behavior 字段）——
    // 此处用"传入多余字段也不影响结果"做行为层锁定。
    const withNoise = {
      ...signals({ verdict: { type: 'APPROVE', confidence: 0.9 } }),
      selfVerificationCount: 99,
      explorationCount: 99,
      draftingRatio: 99,
    } as TurnQualitySignals;
    const clean = signals({ verdict: { type: 'APPROVE', confidence: 0.9 } });
    expect(scoreTurn(withNoise)!.score).toBe(scoreTurn(clean)!.score);
  });

  it('② 不判正确性：分数语义为相对分（同输入恒等 + 带口径版本）', () => {
    const s = signals({ verdict: { type: 'REJECT', confidence: 0.9 } });
    const a = scoreTurn(s)!;
    const b = scoreTurn(s)!;
    expect(a.score).toBe(b.score);
    expect(a.evaluatorVersion).toBe(EVALUATOR_VERSION);
    // REJECT 不等于"错" ⇒ 分数是相对分，不是正确率（此处断言其仍 > 0）
    expect(a.score).toBeGreaterThan(0);
  });
});
