// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B8（2026-11-09，设计稿 §5-3）：日预算耗尽 ⇒ 任务停止并出回执。
 *
 * 覆盖：
 *  - `daily_budget_exhausted` 是**独立分类**（不与轮次预算混淆），且不产生降级动作、
 *    不消耗「先降级一次」额度（放行前重试必再拒）；
 *  - 主循环的停止判据 `budgetStopped` 只看结构化字段；
 *  - 回执展示日预算原因，且与其他分类同票时优先展示。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  budgetStopped,
  classifyStepFailure,
  DAILY_BUDGET_TERMINATION_REASON,
  degradationActionFor,
  FAILURE_CATEGORY_LABELS,
  RECOVERABLE_FAILURE_CATEGORIES,
  takeOneShotDegradation,
} from '../../src/tasks/lro/failureRecovery';
import {
  collectFailureFacts,
  formatPdcaReceipt,
  resolveReceiptNextSteps,
  type PdcaReceiptFacts,
} from '../../src/tasks/lro/terminalReceipt';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { AuditReport } from '../../src/tasks/AuditReport';

describe('B8：日预算耗尽的结构化判定', () => {
  it('闸门终止原因 ⇒ daily_budget（不与 turn_budget 混淆）', () => {
    expect(
      classifyStepFailure({
        terminationReason: DAILY_BUDGET_TERMINATION_REASON,
      })
    ).toBe('daily_budget');
    expect(classifyStepFailure({ terminationReason: 'budget_exhausted' })).toBe(
      'turn_budget'
    );
  });

  it('不属可恢复类、无降级动作、不消耗降级额度', () => {
    expect(RECOVERABLE_FAILURE_CATEGORIES.has('daily_budget')).toBe(false);
    expect(degradationActionFor('daily_budget')).toBeNull();
    const ledger = { used: false };
    expect(takeOneShotDegradation(ledger, 'daily_budget')).toBeNull();
    expect(ledger.used).toBe(false);
  });

  it('计划中存在该原因 ⇒ 主循环应停止', () => {
    expect(
      budgetStopped({
        steps: [{ terminationReason: 'daily_budget_exhausted' }],
      })
    ).toBe(true);
    expect(budgetStopped({ steps: [{ terminationReason: 'max_turns' }] })).toBe(
      false
    );
    expect(budgetStopped({ steps: [{}] })).toBe(false);
  });
});

describe('B11：回执的下一步建议（只给事实确定的动作）', () => {
  it('日预算停止 ⇒ resume 需先放行/重置预算', () => {
    const steps = resolveReceiptNextSteps({
      taskId: 'pdca_b11',
      replanAvailable: false,
      failureCategory: 'daily_budget',
    });
    expect(steps).toEqual([
      'POST /v1/pdca/pdca_b11/resume 续跑（需先放行/重置日预算）',
    ]);
  });

  it('预算停止优先于 replan（同票不叠加，避免给出无效动作）', () => {
    const steps = resolveReceiptNextSteps({
      taskId: 'pdca_b11',
      replanAvailable: true,
      failureCategory: 'daily_budget',
    });
    expect(steps.length).toBe(1);
    expect(steps[0]).toContain('放行/重置日预算');
    expect(steps[0]).not.toContain('replan');
  });

  it('仅可 replan ⇒ resume 续跑（replan）；都没有 ⇒ 不给', () => {
    expect(
      resolveReceiptNextSteps({ taskId: 'pdca_b11', replanAvailable: true })
    ).toEqual(['POST /v1/pdca/pdca_b11/resume 续跑（replan）']);
    expect(
      resolveReceiptNextSteps({ taskId: 'pdca_b11', replanAvailable: false })
    ).toEqual([]);
  });

  it('回执文案随 nextSteps 渲染「下一步」段', () => {
    const text = formatPdcaReceipt({
      taskId: 'pdca_b11',
      phase: 'failed',
      completed: 1,
      total: 2,
      failed: 1,
      nextSteps: resolveReceiptNextSteps({
        taskId: 'pdca_b11',
        replanAvailable: false,
        failureCategory: 'daily_budget',
      }),
    });
    expect(text).toContain('➡️ 下一步：');
    expect(text).toContain('放行/重置日预算');
  });
});

describe('B8：回执标注日预算停止', () => {
  const base: PdcaReceiptFacts = {
    taskId: 'pdca_b8_test',
    phase: 'failed',
    completed: 1,
    total: 3,
    failed: 2,
    replanAvailable: false,
    taskFailed: true,
  };

  it('分类 ⇒ 追加「失败原因」段（预算文案）', () => {
    const text = formatPdcaReceipt({
      ...base,
      failureCategory: 'daily_budget',
    });
    expect(text).toContain(FAILURE_CATEGORY_LABELS.daily_budget);
  });

  describe('从计划汇总（同票优先日预算）', () => {
    let plansDir: string;

    beforeAll(() => {
      plansDir = mkdtempSync(join(tmpdir(), 'b8-plans-'));
      taskOrchestrator.setPlansDir(plansDir);
    });

    afterAll(() => {
      rmSync(plansDir, { recursive: true, force: true });
    });

    it('日预算失败 + 工具失败各一 ⇒ 取 daily_budget', () => {
      const plan = taskOrchestrator.createPlan(
        'B8 汇总',
        ['等待预算放行', '工具失败'],
        'sess-b8'
      );
      plan.status = 'failed';
      plan.steps[0].status = 'failed';
      plan.steps[0].terminationReason = DAILY_BUDGET_TERMINATION_REASON;
      plan.steps[1].status = 'failed';
      plan.steps[1].toolOutcomes = {
        outcomes: [],
        total: 2,
        successCount: 0,
        failedCount: 2,
        securityIntercepted: 0,
        pendingApproval: 0,
      };
      const audit: AuditReport = {
        taskId: `pdca_b8_${Date.now().toString(36)}`,
        planId: plan.id,
        totalSteps: 2,
        completedSteps: 0,
        failedSteps: 2,
        skippedSteps: 0,
        totalDurationMs: 0,
        totalRetries: 0,
        steps: [],
        summary: '',
        generatedAt: Date.now(),
      };

      expect(
        collectFailureFacts(taskOrchestrator.getPlan(audit.planId), audit)
      ).toEqual({ failureCategory: 'daily_budget' });
    });
  });
});
