// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D7 一期：计划影响预演（零执行、零写入）。
 *
 * 验收（`.trae/specs/plan-impact-preview.md`）：
 * - 副作用按声明分类计数；未声明 ⇒ `unknown`（不推断）；
 * - 关注项（失败 / 安全拦截 / 待审批）来自台账汇总；
 * - 产物去重排序、剩余步骤带依赖序号、风险定级确定；
 * - 纯函数可复现；无台账不塞空段落（续跑指令只在有事实时追加）；
 * - 生产接线：`resolveStartupPlanResume` 注入副作用解析后，指令含「上次执行影响」。
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import type { Plan, PlanStep } from '../../../src/tasks/TaskOrchestrator';
import {
  buildPlanImpactPreview,
  hasRecordedImpact,
  renderPlanImpactPreview,
} from '../../../src/tasks/plan/planImpactPreview';
import {
  buildPlanResumeInstruction,
  resetStartupPlanResumesForTest,
  resolveStartupPlanResume,
  buildPlanResumeTaskId,
  planHeartbeatMs,
  type PlanResumeSource,
} from '../../../src/tasks/plan/planStartupResume';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const MINUTE = 60_000;

/** 工具 → 副作用类别（测试用假解析器，与 `tools/toolEffects` 同值域） */
const EFFECTS: Record<string, 'none' | 'local' | 'external'> = {
  file_read: 'none',
  file_write: 'local',
  bash: 'external',
};

function step(over: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step_1',
    description: '做第一步',
    status: 'completed',
    taskId: 'task_1',
    retryCount: 0,
    maxRetries: 3,
    ...over,
  };
}

function outcome(toolName: string, over: Record<string, unknown> = {}) {
  return {
    toolName,
    success: true,
    securityIntercepted: false,
    pendingApproval: false,
    ...over,
  };
}

function plan(over: Partial<Plan> = {}): Plan {
  const heartbeat = new Date(NOW - 30 * MINUTE).toISOString();
  return {
    id: 'plan_a',
    description: '给登录页加深色主题',
    status: 'running',
    createdAt: heartbeat,
    sessionId: 'sess_1',
    lastHeartbeatAt: heartbeat,
    steps: [
      step({
        artifacts: ['src/theme.css', 'src/theme.css'],
        toolOutcomes: {
          outcomes: [
            outcome('file_read'),
            outcome('file_write'),
            outcome('bash', { success: false, securityIntercepted: true }),
            outcome('mystery_tool'),
          ],
          total: 4,
          successCount: 2,
          failedCount: 1,
          securityIntercepted: 1,
          pendingApproval: 0,
        },
      }),
      step({ id: 'step_2', description: '替换主题变量', status: 'pending' }),
      step({
        id: 'step_3',
        description: '回归测试',
        status: 'pending',
        dependsOn: ['step_2'],
      }),
    ],
    ...over,
  };
}

const resolveEffect = (name: string) => EFFECTS[name];

describe('buildPlanImpactPreview：只读台账的确定性预演', () => {
  it('副作用分类计数 + 未声明计 unknown + 关注项来自汇总', () => {
    const preview = buildPlanImpactPreview(plan(), { resolveEffect });
    expect(preview.effects).toEqual({
      none: 1,
      local: 1,
      external: 1,
      unknown: 1,
    });
    expect(preview.attention).toEqual({
      failed: 1,
      securityIntercepted: 1,
      pendingApproval: 0,
    });
    expect(preview.steps).toEqual({ total: 3, completed: 1, remaining: 2 });
    // 有安全拦截 ⇒ 最高风险定级（`intercepted`：避开目标状态机的 blocked 词汇）
    expect(preview.risk).toBe('intercepted');
  });

  it('产物去重排序；剩余步骤带依赖序号', () => {
    const preview = buildPlanImpactPreview(plan(), { resolveEffect });
    expect(preview.artifacts).toEqual(['src/theme.css']);
    expect(preview.remainingSteps).toEqual([
      { index: 2, description: '替换主题变量', dependsOn: [] },
      { index: 3, description: '回归测试', dependsOn: [2] },
    ]);
  });

  it('纯函数可复现；无解析器 ⇒ 全部 unknown', () => {
    const a = buildPlanImpactPreview(plan(), { resolveEffect });
    expect(renderPlanImpactPreview(a)).toBe(
      renderPlanImpactPreview(buildPlanImpactPreview(plan(), { resolveEffect }))
    );

    const noResolver = buildPlanImpactPreview(plan());
    expect(noResolver.effects).toEqual({
      none: 0,
      local: 0,
      external: 0,
      unknown: 4,
    });
  });

  it('风险定级：外部 > 本地 > 无；拦截最高', () => {
    const externalOnly = plan({
      steps: [
        step({
          toolOutcomes: {
            outcomes: [outcome('bash')],
            total: 1,
            successCount: 1,
            failedCount: 0,
            securityIntercepted: 0,
            pendingApproval: 0,
          },
        }),
      ],
    });
    expect(buildPlanImpactPreview(externalOnly, { resolveEffect }).risk).toBe(
      'external'
    );

    const localOnly = plan({
      steps: [
        step({
          artifacts: ['a.txt'],
          toolOutcomes: {
            outcomes: [outcome('file_write')],
            total: 1,
            successCount: 1,
            failedCount: 0,
            securityIntercepted: 0,
            pendingApproval: 0,
          },
        }),
      ],
    });
    expect(buildPlanImpactPreview(localOnly, { resolveEffect }).risk).toBe(
      'local-only'
    );
    expect(buildPlanImpactPreview(plan({ steps: [step()] })).risk).toBe('none');
  });

  it('无台账且无产物 ⇒ 不认为有可展示影响', () => {
    const empty = buildPlanImpactPreview(plan({ steps: [step()] }));
    expect(hasRecordedImpact(empty)).toBe(false);
    expect(empty.notes.join('')).toContain('尚无工具结局台账');
  });
});

describe('D7 × D3：续跑指令追加「上次执行影响」', () => {
  const prevFlag = process.env['FEATURE_PLAN_STARTUP_RESUME'];

  beforeEach(() => {
    process.env['FEATURE_PLAN_STARTUP_RESUME'] = 'true';
    resetStartupPlanResumesForTest();
  });

  afterAll(() => {
    if (prevFlag === undefined)
      delete process.env['FEATURE_PLAN_STARTUP_RESUME'];
    else process.env['FEATURE_PLAN_STARTUP_RESUME'] = prevFlag;
  });

  it('有台账 ⇒ 追加影响段落（含产物与副作用计数）', () => {
    const text = buildPlanResumeInstruction(plan(), { resolveEffect });
    expect(text).toContain('## 上次执行影响');
    expect(text).toContain('本地 1 · 外部 1');
    expect(text).toContain('src/theme.css');
    expect(text).toContain('不执行任何工具');
  });

  it('无台账 ⇒ 不追加空段落', () => {
    const text = buildPlanResumeInstruction(plan({ steps: [step()] }));
    expect(text).not.toContain('## 上次执行影响');
  });

  it('resolveStartupPlanResume 透传副作用解析（触达指令）', async () => {
    const source: PlanResumeSource = {
      initialize: async () => {},
      getAllPlans: () => [plan()],
      getPlan: () => plan(),
      resetStaleRunningSteps: () => 0,
    };
    const target = await resolveStartupPlanResume({
      taskId: buildPlanResumeTaskId('plan_a', planHeartbeatMs(plan())),
      source,
      now: NOW,
      resolveEffect,
    });
    expect(target?.instruction).toContain('## 上次执行影响');
    expect(target?.instruction).toContain('外部 1');
  });
});
