// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-08（真机 `pdca_mw6p0s5t` / `pdca_mw6rx5kr`）：PDCA **终态回执**文案。
 *
 * 背景：HTTP 启动的编排器没有 `onTaskMessage` ⇒ 会话拿不到任何消息（真机 4/4 步完成、
 * 产物正确，`messages.jsonl` 仍 0 字节）。回执下沉到编排层（`lro/terminalReceipt`）后，
 * completed / failed（含 escalate）/ 挂起/续跑 三个落点统一发出。
 *
 * 口径：**不做状态词汇比较**（`lint:state-ratchet`：状态字面量须收敛到唯一事实源），
 * 只用「步数事实 + 阶段名（数据）」决定文案。
 */
import { describe, expect, it } from 'bun:test';
import {
  collectDeliveryFacts,
  formatPdcaReceipt,
} from '../../src/tasks/lro/terminalReceipt';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';

const base = { taskId: 'pdca_demo', completed: 4, total: 4, failed: 0 };

describe('formatPdcaReceipt — 终态回执文案', () => {
  it('全部完成且无失败 ⇒ ✅ 完成（带步数与 taskId）', () => {
    const text = formatPdcaReceipt({ ...base, phase: 'completed' });
    expect(text).toContain('长程任务完成');
    expect(text).toContain('4/4 步');
    expect(text).toContain('pdca_demo');
  });

  it('尚未结束（如等待审批）⇒ ⏸ 并展示阶段名', () => {
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'stage_awaiting_approval',
      completed: 2,
      total: 4,
      failed: 0,
    });
    expect(text).toContain('未结束');
    expect(text).toContain('2/4 步');
    expect(text).toContain('stage_awaiting_approval');
  });

  it('有失败/取消步 ⇒ ⚠️ 且带失败步数', () => {
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'execute',
      completed: 2,
      total: 4,
      failed: 1,
    });
    expect(text).toContain('未完成');
    expect(text).toContain('2/4 步');
    expect(text).toContain('1 步失败');
  });

  it('步数全完成但有失败步 ⇒ 不冒充完成', () => {
    const text = formatPdcaReceipt({ ...base, phase: 'completed', failed: 1 });
    expect(text).toContain('未完成');
    expect(text).not.toContain('长程任务完成');
  });

  // 2026-11-08（真机 pdca_mw76rof9）：escalate 后 phase 留在 execute，用户只能从回执知道
  // "可以 replan 续跑"。
  it('escalate（可 replan）⇒ ⚠️ 回执补「可 replan 续跑」；不可 replan 时不写', () => {
    const withReplan = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'execute',
      completed: 0,
      total: 2,
      failed: 2,
      replanAvailable: true,
    });
    expect(withReplan).toContain('可 replan 续跑');
    const without = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'execute',
      completed: 0,
      total: 2,
      failed: 2,
    });
    expect(without).not.toContain('可 replan 续跑');
  });

  it('挂起等待审批（即使可见步骤全部完成）⇒ ⏸ 挂起，不冒充完成', () => {
    // 真机 `pdca_mw6tie3k`：产物已写好、只剩一条 shell 命令等批准 ⇒ 2/2 步完成，
    // 但任务确实在等审批；只按步数判定会输出假的「✅ 完成」。
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'stage_awaiting_approval',
      completed: 2,
      total: 2,
      failed: 0,
      paused: true,
    });
    expect(text).toContain('已挂起等待审批');
    expect(text).not.toContain('长程任务完成');
  });

  it('已中止（用户拒绝审批）⇒ ⏹ 中止，不冒充完成/未结束', () => {
    // 真机 `pdca_mw6vej5m`：拒绝审批后此前完全无回执，会话停在「⏸ 已挂起等待审批」
    const text = formatPdcaReceipt({
      taskId: 'pdca_demo',
      phase: 'abort',
      completed: 2,
      total: 3,
      failed: 0,
      aborted: true,
    });
    expect(text).toContain('已中止');
    expect(text).toContain('2/3 步');
    expect(text).not.toContain('长程任务完成');
  });

  // 2026-11-08（真机 pdca_mw7f7h2g）：目标未收敛 ⇒ 步骤 2/2 全通过、0 失败，但任务已 failed；
  // 只按步数会输出假的「✅ 完成」，与 plan.status=failed / `/resume` 409 矛盾。
  it('任务级失败（目标未收敛）但步骤全完成 ⇒ ⚠️，不冒充完成', () => {
    const text = formatPdcaReceipt({
      ...base,
      phase: 'failed',
      taskFailed: true,
    });
    expect(text).toContain('未完成');
    expect(text).toContain('4/4 步');
    expect(text).toContain('目标未通过终态校验');
    expect(text).not.toContain('长程任务完成');
  });
});

// B3（2026-11-09）：交付回执的增量事实 —— 存在即展示，缺失不造占位。
describe('formatPdcaReceipt — 交付分段', () => {
  it('无交付事实 ⇒ 文案与既有口径逐字一致（不追加空段）', () => {
    const text = formatPdcaReceipt({ ...base, phase: 'completed' });
    expect(text).not.toContain('📦');
    expect(text).not.toContain('未验证');
    expect(text).not.toContain('下一步');
  });

  it('有产物 / 未验证项 / 下一步 ⇒ 逐段展示', () => {
    const text = formatPdcaReceipt({
      ...base,
      phase: 'completed',
      artifacts: ['src/a.ts'],
      unverified: ['第 2 步：接口返回 200'],
      nextSteps: ['POST /v1/pdca/pdca_demo/resume 续跑（replan）'],
    });
    expect(text).toContain('📦 产物：');
    expect(text).toContain('- src/a.ts');
    expect(text).toContain('⚠️ 未验证的验收项：');
    expect(text).toContain('- 第 2 步：接口返回 200');
    expect(text).toContain('➡️ 下一步：');
  });

  it('nextSteps 最多展示 3 条；空白项不展示', () => {
    const text = formatPdcaReceipt({
      ...base,
      phase: 'completed',
      artifacts: ['  '],
      nextSteps: ['a', 'b', 'c', 'd'],
    });
    expect(text).not.toContain('📦');
    expect(text).toContain('- a');
    expect(text).toContain('- c');
    expect(text).not.toContain('- d');
  });
});

describe('collectDeliveryFacts — 只投影既有事实', () => {
  function step(over: Partial<PlanStep> & { id: string }): PlanStep {
    return {
      id: over.id,
      description: over.description ?? over.id,
      status: over.status ?? 'pending',
      taskId: over.taskId ?? 'pdca_demo',
      retryCount: over.retryCount ?? 0,
      maxRetries: over.maxRetries ?? 3,
      artifacts: over.artifacts,
      acceptanceCriteria: over.acceptanceCriteria,
      reviewResult: over.reviewResult,
    };
  }

  function plan(steps: PlanStep[]): Plan {
    return {
      id: 'plan_1',
      description: 'demo',
      steps,
      status: 'running',
      createdAt: new Date(0).toISOString(),
      sessionId: 'session_1',
    };
  }

  it('无计划 ⇒ 空（不造占位）', () => {
    expect(collectDeliveryFacts(undefined)).toEqual({});
  });

  it('产物跨步去重；未完成且无审查结果的验收项计入 unverified', () => {
    const facts = collectDeliveryFacts(
      plan([
        step({
          id: 'step_1',
          status: 'completed',
          artifacts: ['src/a.ts'],
        }),
        step({
          id: 'step_2',
          status: 'failed',
          artifacts: ['src/a.ts', 'src/b.ts'],
          acceptanceCriteria: '接口返回 200',
        }),
      ])
    );
    expect(facts.artifacts).toEqual(['src/a.ts', 'src/b.ts']);
    expect(facts.unverified).toEqual(['接口返回 200']);
  });

  it('已验证但未通过的步骤不计入 unverified（那是「未通过」，由失败步数表达）', () => {
    const facts = collectDeliveryFacts(
      plan([
        step({
          id: 'step_1',
          status: 'failed',
          acceptanceCriteria: '构建通过',
          reviewResult: {
            stepId: 'step_1',
            pass: false,
            score: 20,
            issues: [],
            summary: 'failed',
            reviewedAt: 0,
          },
        }),
      ])
    );
    expect(facts.unverified).toBeUndefined();
  });
});
