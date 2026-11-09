// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B5 / D4（2026-11-09）：失败闭环「先降级一次，再报人」的纯判定门禁。
 *
 * 覆盖：
 *  - 结构化失败分类（不读错误文案）；
 *  - 分类 → 降级动作（全部落在既有 retry / replan 链上）；
 *  - `output_budget_exhausted` 视为非收敛（修掉"假完成"）；
 *  - 预算类纳入既有扩容续跑候选（一次扩容，限额不变）；
 *  - 回执追加失败原因分类，未归类不展示。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyStepFailure,
  degradationActionFor,
  FAILURE_CATEGORY_LABELS,
  RECOVERABLE_FAILURE_CATEGORIES,
} from '../../src/tasks/lro/failureRecovery';
import {
  isNonConvergedTermination,
  planTurnsExtensionDecision,
  shouldReRollExtendedStep,
} from '../../src/tasks/lro/pureDecisions';
import {
  collectFailureFacts,
  formatPdcaReceipt,
  type PdcaReceiptFacts,
} from '../../src/tasks/lro/terminalReceipt';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { AuditReport } from '../../src/tasks/AuditReport';

describe('D4：单步失败分类（只看结构化字段）', () => {
  it('输出预算被推理耗尽 ⇒ output_budget', () => {
    expect(
      classifyStepFailure({ terminationReason: 'output_budget_exhausted' })
    ).toBe('output_budget');
  });

  it('轮次 / 总预算 / 超时 ⇒ turn_budget', () => {
    for (const reason of ['max_turns', 'budget_exhausted', 'timeout']) {
      expect(classifyStepFailure({ terminationReason: reason })).toBe(
        'turn_budget'
      );
    }
  });

  it('模型调用异常（供应商暂缓 / 网络）⇒ provider_deferred', () => {
    expect(classifyStepFailure({ terminationReason: 'error' })).toBe(
      'provider_deferred'
    );
  });

  it('中止 / 等待审批不自动降级 ⇒ unclassified', () => {
    expect(classifyStepFailure({ terminationReason: 'aborted' })).toBe(
      'unclassified'
    );
    expect(
      classifyStepFailure({ terminationReason: 'awaiting_approval' })
    ).toBe('unclassified');
  });

  it('单步工具全失败（无成功、无待审批）⇒ tool_failure', () => {
    expect(
      classifyStepFailure({
        toolOutcomes: {
          successCount: 0,
          failedCount: 3,
          pendingApproval: 0,
        },
      })
    ).toBe('tool_failure');
    // 有成功 / 有待审批 ⇒ 不归类（证据不足，不猜）
    expect(
      classifyStepFailure({
        toolOutcomes: {
          successCount: 1,
          failedCount: 3,
          pendingApproval: 0,
        },
      })
    ).toBe('unclassified');
    expect(
      classifyStepFailure({
        toolOutcomes: {
          successCount: 0,
          failedCount: 3,
          pendingApproval: 1,
        },
      })
    ).toBe('unclassified');
  });
});

describe('D4：分类 → 降级动作（复用既有机制）', () => {
  it('预算类 ⇒ 在既有 retry 上多给一次尝试', () => {
    expect(degradationActionFor('output_budget')).toBe('extra_attempt');
    expect(degradationActionFor('turn_budget')).toBe('extra_attempt');
  });

  it('工具持续失败 ⇒ 既有 escalate → 增量 replan（降低计划粒度）', () => {
    expect(degradationActionFor('tool_failure')).toBe('replan');
  });

  it('供应商层已 failover / 未归类 ⇒ 无额外动作（不消耗额度）', () => {
    expect(degradationActionFor('provider_deferred')).toBeNull();
    expect(degradationActionFor('unclassified')).toBeNull();
  });

  it('可恢复集合与文案齐备（unclassified 不展示）', () => {
    expect(RECOVERABLE_FAILURE_CATEGORIES.has('unclassified')).toBe(false);
    for (const category of RECOVERABLE_FAILURE_CATEGORIES) {
      expect(FAILURE_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
  });
});

describe('D4：预算类不再被记成"完成"，并进入既有扩容候选', () => {
  it('output_budget_exhausted 属非收敛终止原因', () => {
    expect(isNonConvergedTermination('output_budget_exhausted')).toBe(true);
    // 回归：原三类仍在
    expect(isNonConvergedTermination('max_turns')).toBe(true);
    expect(isNonConvergedTermination('budget_exhausted')).toBe(true);
    expect(isNonConvergedTermination('timeout')).toBe(true);
    // `aborted`（循环检测 / 用户中止）与 `error` 原本就是非收敛
    expect(isNonConvergedTermination('aborted')).toBe(true);
    expect(isNonConvergedTermination('error')).toBe(true);
  });

  it('预算类触发一次扩容（限额不变）；中止类不触发', () => {
    const applied = planTurnsExtensionDecision(
      [{ terminationReason: 'output_budget_exhausted' }],
      0,
      1
    );
    expect(applied).toEqual({ apply: true, multiplier: 2, count: 1 });

    // 已达上限 ⇒ 不再扩容（与既有语义一致）
    expect(
      planTurnsExtensionDecision(
        [{ terminationReason: 'output_budget_exhausted' }],
        1,
        1
      ).apply
    ).toBe(false);

    expect(
      planTurnsExtensionDecision([{ terminationReason: 'aborted' }], 0, 1).apply
    ).toBe(false);
  });

  it('扩容激活时预算类步骤置回 pending，中止 / 循环检测不置回', () => {
    expect(shouldReRollExtendedStep(true, 'output_budget_exhausted')).toBe(
      true
    );
    expect(shouldReRollExtendedStep(true, 'max_turns')).toBe(true);
    expect(shouldReRollExtendedStep(true, 'aborted')).toBe(false);
    expect(shouldReRollExtendedStep(false, 'max_turns')).toBe(false);
  });
});

describe('D4：失败回执带原因分类', () => {
  const base: PdcaReceiptFacts = {
    taskId: 'pdca_d4_test',
    phase: 'failed',
    completed: 0,
    total: 2,
    failed: 2,
    replanAvailable: false,
    taskFailed: true,
  };

  it('有分类 ⇒ 追加「失败原因」段', () => {
    const text = formatPdcaReceipt({
      ...base,
      failureCategory: 'output_budget',
    });
    expect(text).toContain('🔎 失败原因：');
    expect(text).toContain('输出预算被推理耗尽');
  });

  it('未归类 / 未提供 ⇒ 不追加（不造占位）', () => {
    expect(
      formatPdcaReceipt({ ...base, failureCategory: 'unclassified' })
    ).not.toContain('🔎 失败原因：');
    expect(formatPdcaReceipt(base)).not.toContain('🔎 失败原因：');
  });

  describe('从计划汇总分类', () => {
    let plansDir: string;

    beforeAll(() => {
      plansDir = mkdtempSync(join(tmpdir(), 'd4-plans-'));
      taskOrchestrator.setPlansDir(plansDir);
    });

    afterAll(() => {
      rmSync(plansDir, { recursive: true, force: true });
    });

    function report(failedSteps: number, status: 'failed' | 'running') {
      const plan = taskOrchestrator.createPlan(
        'D4 汇总',
        ['产出文件', '补充验证'],
        'sess-d4'
      );
      plan.status = status;
      plan.steps[0].status = 'failed';
      plan.steps[0].terminationReason = 'output_budget_exhausted';
      plan.steps[1].status = 'failed';
      plan.steps[1].terminationReason = 'max_turns';
      const audit: AuditReport = {
        taskId: `pdca_d4_${Date.now().toString(36)}`,
        planId: plan.id,
        totalSteps: 2,
        completedSteps: 0,
        failedSteps,
        skippedSteps: 0,
        totalDurationMs: 0,
        totalRetries: 0,
        steps: [],
        summary: '',
        generatedAt: Date.now(),
      };
      return audit;
    }

    it('取出现次数最多的分类（同票按固定优先级）', () => {
      const audit = report(2, 'failed');
      expect(
        collectFailureFacts(taskOrchestrator.getPlan(audit.planId), audit)
      ).toEqual({ failureCategory: 'output_budget' });
    });

    it('全部通过 ⇒ 空（不因任务字段误判）', () => {
      const audit = report(0, 'running');
      const plan = taskOrchestrator.getPlan(audit.planId);
      // 即使步骤仍标 failed，没有失败统计且任务未失败 ⇒ 不给分类
      expect(collectFailureFacts(plan, audit)).toEqual({});
    });
  });
});
