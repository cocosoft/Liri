/**
 * ReviewGate 单元测试
 *
 * 覆盖：
 *   - createReviewGate 工厂（默认 / disabled / 自定义配置）
 *   - DefaultReviewGate.decide 决策逻辑（分数门槛 / 阻塞级 / 重试上限）
 *   - NoopReviewGate 直接批准
 *   - shouldReview 门控
 */
import { describe, it, expect, spyOn } from 'bun:test';
import {
  createReviewGate,
  DefaultReviewGate,
  NoopReviewGate,
  DEFAULT_REVIEW_GATE_CONFIG,
} from './ReviewGate.js';
import type { ReviewGateContext } from './ReviewGate.js';
import type { PlanReview, ReviewIssue } from '../PlanReview.js';
import type { PlanStep } from '../TaskOrchestrator.js';
import { configManager, getConfigManager } from '@modules/config';

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step-1',
    description: 'test step',
    status: 'completed',
    acceptanceCriteria: 'done',
    result: 'ok',
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  } as PlanStep;
}

function makeReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    stepId: 'step-1',
    pass: true,
    score: 90,
    issues: [],
    summary: 'ok',
    reviewedAt: Date.now(),
    ...overrides,
  };
}

function makeCtx(step: PlanStep): ReviewGateContext {
  return {
    taskId: 'task-1',
    planId: 'plan-1',
    step,
    isolation: {
      abortController: new AbortController(),
      workspace: '/tmp/ws',
      abort: () => {},
      cleanup: () => {},
    },
    executor: async () => '{"pass":true,"score":90,"issues":[],"summary":"ok"}',
    verifier: {
      verify: async () => ({
        passed: true,
        confidence: 0.95,
        verdict: 'APPROVE' as const,
      }),
    },
  };
}

describe('ReviewGate', () => {
  it('createReviewGate 默认返回 default 门，配置与默认一致', () => {
    const gate = createReviewGate();
    expect(gate.name).toBe('default');
    expect(gate.getConfig().mode).toBe('default');
    expect(gate.getConfig().blockingSeverities).toEqual(['critical', 'major']);
  });

  it('createReviewGate 从 config.json 读取（pdca.review.gate 优先于环境变量）', () => {
    // configManager 是 Proxy（每次访问返回新 bound 函数），spyOn 须作用于底层实例
    const instance = getConfigManager();
    const spy = spyOn(instance, 'getConfigValue').mockImplementation(
      (key: string) => {
        if (key === 'pdca.review.gate') {
          return { mode: 'lenient', passThreshold: 55 };
        }
        return undefined;
      }
    );
    try {
      const gate = createReviewGate();
      expect(gate.getConfig().mode).toBe('lenient');
      expect(gate.getConfig().passThreshold).toBe(55);
      // lenient 预设：仅 critical 阻塞
      expect(gate.getConfig().blockingSeverities).toEqual(['critical']);
    } finally {
      spy.mockRestore();
    }
  });

  it('createReviewGate 自定义配置覆盖默认', () => {
    const gate = createReviewGate({ passThreshold: 80, mode: 'strict' });
    expect(gate.getConfig().passThreshold).toBe(80);
    expect(gate.getConfig().mode).toBe('strict');
    expect(gate.getConfig().blockingSeverities).toContain('minor');
  });

  it('disabled 模式创建 NoopReviewGate，shouldReview=false', () => {
    const gate = createReviewGate({ mode: 'disabled' });
    expect(gate).toBeInstanceOf(NoopReviewGate);
    expect(gate.shouldReview(makeCtx(makeStep()))).toBe(false);
  });

  describe('DefaultReviewGate.decide', () => {
    it('pass 且无阻塞 issue → approved', async () => {
      const gate = new DefaultReviewGate();
      const step = makeStep({ reviewResult: makeReview() });
      expect(await gate.decide(makeCtx(step))).toBe('approved');
    });

    it('存在 critical issue → retry（未达上限）', async () => {
      const gate = new DefaultReviewGate();
      const issues: ReviewIssue[] = [
        { severity: 'critical', description: 'broken' },
      ];
      const step = makeStep({
        reviewResult: makeReview({ pass: false, issues }),
        retryCount: 0,
      });
      expect(await gate.decide(makeCtx(step))).toBe('retry');
    });

    it('重试达上限 → escalate', async () => {
      const gate = new DefaultReviewGate({ maxRetries: 2 });
      const issues: ReviewIssue[] = [
        { severity: 'major', description: 'broken' },
      ];
      const step = makeStep({
        reviewResult: makeReview({ pass: false, issues }),
        retryCount: 2,
        maxRetries: 2,
      });
      expect(await gate.decide(makeCtx(step))).toBe('escalate');
    });

    it('分数低于门槛 → 不通过（retry）', async () => {
      const gate = new DefaultReviewGate({ passThreshold: 80 });
      const step = makeStep({
        reviewResult: makeReview({ pass: true, score: 60 }),
      });
      expect(await gate.decide(makeCtx(step))).toBe('retry');
    });

    it('minor issue 不阻塞（默认 severity 配置）', async () => {
      const gate = new DefaultReviewGate();
      const issues: ReviewIssue[] = [
        { severity: 'minor', description: 'nitpick' },
      ];
      const step = makeStep({ reviewResult: makeReview({ issues }) });
      expect(await gate.decide(makeCtx(step))).toBe('approved');
    });

    it('无 reviewResult 时按 retryCount 决策', async () => {
      const gate = new DefaultReviewGate();
      const step = makeStep({ reviewResult: undefined, retryCount: 1 });
      expect(await gate.decide(makeCtx(step))).toBe('retry');
    });
  });

  describe('NoopReviewGate', () => {
    it('reviewStep 返回 always-pass，decide 返回 approved', async () => {
      const gate = new NoopReviewGate();
      const review = await gate.reviewStep(makeCtx(makeStep()));
      expect(review.pass).toBe(true);
      expect(review.score).toBe(100);
      expect(await gate.decide(makeCtx(makeStep()))).toBe('approved');
    });
  });

  it('默认配置不可变', () => {
    const cfg = { ...DEFAULT_REVIEW_GATE_CONFIG };
    const gate = createReviewGate();
    expect(gate.getConfig().maxRetries).toBe(cfg.maxRetries);
  });
});
