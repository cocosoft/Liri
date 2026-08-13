// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D1（M7）：StageOrchestrator 2 阶段 MVP 测试
 * 阶段流转（requirement→design）、审批门（stage_awaiting_approval）、
 * checkpoint 恢复、buildStagePrompt 基线注入。
 */
import { describe, it, expect } from 'bun:test';
import {
  StageOrchestrator,
  buildStagePrompt,
  type StageChainRecord,
} from '../../src/tasks/StageOrchestrator';

const deps = (calls: string[], tokens = 10) => ({
  runStage: async (stage: { id: string }, chain: StageChainRecord) => {
    calls.push(stage.id);
    return { artifact: `产物-${stage.id}`, tokens };
  },
});

describe('StageOrchestrator — 2 阶段链（D1/M7）', () => {
  it('requirement 阶段完成后停在审批门（stage_awaiting_approval）', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'stage-test-1',
      '开发一个结算模块',
      's-1',
      deps(calls)
    );

    const status = await orch.run();

    expect(calls).toEqual(['requirement']); // design 未执行（等审批）
    expect(status.phase).toBe('stage_awaiting_approval');
    expect(status.currentStage).toBe('requirement');
    const req = status.stages.find((s) => s.id === 'requirement');
    expect(req?.status).toBe('awaiting_approval');
    expect(req?.artifact).toBe('产物-requirement');
    expect(status.stages.find((s) => s.id === 'design')?.status).toBe(
      'pending'
    );
  });

  it('approve（resumeAfterApproval）后进入 design 并完成阶段链', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'stage-test-2',
      '开发一个结算模块',
      's-2',
      deps(calls)
    );

    await orch.run(); // 停在审批门
    const status = await orch.resumeAfterApproval();

    expect(calls).toEqual(['requirement', 'design']);
    expect(status.phase).toBe('completed');
    expect(status.stages.find((s) => s.id === 'design')?.status).toBe(
      'completed'
    );
  });

  it('非审批挂起状态调用 resumeAfterApproval 抛错', async () => {
    const orch = StageOrchestrator.create('stage-test-3', 'x', 's-3', deps([]));
    await expect(orch.resumeAfterApproval()).rejects.toThrow();
  });

  it('checkpoint 持久化后 fromCheckpoint 可恢复阶段链', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'stage-test-4',
      '开发结算模块',
      's-4',
      deps(calls)
    );
    await orch.run(); // 停在审批门并落 checkpoint

    const restored = StageOrchestrator.fromCheckpoint('stage-test-4', deps([]));
    expect(restored).not.toBeNull();
    const status = restored!.getStatus();
    expect(status.phase).toBe('stage_awaiting_approval');
    expect(status.stages.find((s) => s.id === 'requirement')?.status).toBe(
      'awaiting_approval'
    );

    // 恢复后可继续审批 → design
    const final = await restored!.resumeAfterApproval();
    expect(final.phase).toBe('completed');
  });

  it('buildStagePrompt：design 阶段注入 requirement 产物基线', () => {
    const chain: StageChainRecord = {
      taskId: 't',
      description: '开发结算模块',
      sessionId: 's',
      currentStage: 'design',
      phase: 'running',
      totalTokens: 0,
      budgetLimitTokens: 0,
      budgetPolicy: 'terminate',
      updatedAt: '',
      stages: [
        {
          id: 'requirement',
          name: '需求分析',
          approval: 'stage_approval',
          status: 'completed',
          pdcaTaskId: 't_requirement',
          artifact: 'PRD：支持微信支付',
        },
        {
          id: 'design',
          name: '设计',
          approval: 'auto',
          status: 'pending',
          pdcaTaskId: 't_design',
        },
      ],
    };
    const prompt = buildStagePrompt(chain.stages[1], chain);
    expect(prompt).toContain('PRD：支持微信支付');
    expect(prompt).toContain('需求规格说明');
  });
});

describe('StageOrchestrator — 成本护栏（D4/M4）', () => {
  it('阶段边界累计 token 到父级 totalTokens', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'budget-test-1',
      'x',
      's',
      deps(calls, 25)
    );
    await orch.run(); // requirement 25 tokens
    const status = orch.getStatus();
    expect(status.totalTokens).toBe(25);
  });

  it('超限 terminate：阶段链失败且后续阶段不执行', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'budget-test-2',
      'x',
      's',
      deps(calls, 120),
      { budgetLimitTokens: 100, budgetPolicy: 'terminate' }
    );
    const status = await orch.run();

    expect(calls).toEqual(['requirement']); // design 未执行
    expect(status.phase).toBe('failed');
    expect(status.budgetExhausted).toBe(true);
  });

  it('超限 warn：警告后继续执行', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'budget-test-3',
      'x',
      's',
      deps(calls, 120),
      { budgetLimitTokens: 100, budgetPolicy: 'warn' }
    );
    await orch.run();
    await orch.resumeAfterApproval(); // design 继续

    expect(calls).toEqual(['requirement', 'design']);
    expect(orch.getStatus().budgetExhausted).toBe(true);
    expect(orch.getStatus().phase).toBe('completed');
  });
});
