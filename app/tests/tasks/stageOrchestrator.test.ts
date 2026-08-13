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

describe('StageOrchestrator — 交付阶段（D6/M8）', () => {
  const runToDelivered = async (taskId: string, tokens = 10) => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      taskId,
      '开发结算模块',
      's',
      deps(calls, tokens)
    );
    await orch.run(); // requirement 停在审批门
    await orch.resumeAfterApproval(); // design + delivery 完成
    return { orch, calls };
  };

  it('全部阶段完成后生成交付清单（打包产物 + 总 tokens + pending）', async () => {
    const { orch, calls } = await runToDelivered('d6-test-1', 25);

    // delivery 为合成阶段：不执行子 PDCA，仅一次审批门
    expect(calls).toEqual(['requirement', 'design']);
    const status = orch.getStatus();
    expect(status.phase).toBe('completed');
    expect(status.stages.find((s) => s.id === 'delivery')?.status).toBe(
      'completed'
    );

    const manifest = status.deliveryManifest;
    expect(manifest).toBeDefined();
    expect(manifest!.taskId).toBe('d6-test-1');
    expect(manifest!.totalTokens).toBe(50); // requirement 25 + design 25
    expect(manifest!.budgetLimitTokens).toBe(0);
    expect(manifest!.acceptance).toBe('pending');
    expect(manifest!.deliveredAt).toBeTruthy();
    // 各阶段产物完整打包（交付物）
    expect(manifest!.artifacts['requirement']).toBe('产物-requirement');
    expect(manifest!.artifacts['design']).toBe('产物-design');
    // 阶段行含产物预览
    const designRow = manifest!.stages.find((s) => s.id === 'design');
    expect(designRow?.artifactPreview).toContain('产物-design');
  });

  it('markDeliveryAccepted 置验收标记并持久化', async () => {
    const { orch } = await runToDelivered('d6-test-2');

    const accepted = await orch.markDeliveryAccepted();
    expect(accepted.deliveryAccepted).toBe(true);
    expect(accepted.deliveryManifest!.acceptance).toBe('accepted');

    // 持久化后 fromCheckpoint 恢复可见
    const restored = StageOrchestrator.fromCheckpoint('d6-test-2', deps([]));
    expect(restored!.getStatus().deliveryAccepted).toBe(true);
    expect(restored!.getStatus().deliveryManifest!.acceptance).toBe('accepted');
  });

  it('未交付（未到 completed）调用 markDeliveryAccepted 抛错', async () => {
    const orch = StageOrchestrator.create(
      'd6-test-3',
      'x',
      's',
      deps([])
    );
    await orch.run(); // 停在审批门，未交付
    await expect(orch.markDeliveryAccepted()).rejects.toThrow();
  });
});

describe('StageOrchestrator — 需求追踪贯穿（D3 消费/偏差 2）', () => {
  it('create 传入 requirementId → record 携带 + prompt 注入 + 交付清单贯穿', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'req-test-1',
      '开发结算模块',
      's',
      deps(calls, 10),
      undefined,
      'req_abc123def456'
    );

    // record 携带
    expect(orch.getStatus().requirementId).toBe('req_abc123def456');

    // requirement 阶段 prompt 注入需求追踪 ID（产物须标注证据）
    const reqStage = orch.getStatus().stages[0];
    const prompt = buildStagePrompt(reqStage, orch.getStatus());
    expect(prompt).toContain('req_abc123def456');
    expect(prompt).toContain('需求追踪 ID');

    // 走完整阶段链（提需求→审批→设计→交付）
    await orch.run(); // 停在审批门
    await orch.resumeAfterApproval();

    // 交付清单贯穿 requirementId
    const manifest = orch.getStatus().deliveryManifest;
    expect(manifest).toBeDefined();
    expect(manifest!.requirementId).toBe('req_abc123def456');
    expect(calls).toEqual(['requirement', 'design']); // delivery 合成阶段
  });
});

describe('MS5 — 端到端剧本（提需求→审批→设计→交付）', () => {
  it('完整剧本：requirement(PRD 审批) → design → delivery 清单 → 验收', async () => {
    const calls: string[] = [];
    const orch = StageOrchestrator.create(
      'ms5-e2e-1',
      '开发一个电商结算模块',
      's',
      deps(calls, 15),
      { budgetLimitTokens: 1000 },
      'req_ms5_e2e'
    );

    // ① 需求阶段：产出 PRD → 停在审批门（stage_awaiting_approval）
    const s1 = await orch.run();
    expect(s1.phase).toBe('stage_awaiting_approval');
    expect(calls).toEqual(['requirement']);
    expect(s1.stages.find((x) => x.id === 'requirement')?.artifact).toBe(
      '产物-requirement'
    );

    // ② 用户审批 → design（auto）→ delivery（合成）→ completed + 交付清单
    const s2 = await orch.resumeAfterApproval();
    expect(s2.phase).toBe('completed');
    expect(calls).toEqual(['requirement', 'design']);
    expect(s2.stages.every((x) => x.status === 'completed')).toBe(true);

    // ③ 交付清单：产物打包 + 总 tokens（15+15）+ 需求贯穿
    const manifest = s2.deliveryManifest!;
    expect(manifest.totalTokens).toBe(30);
    expect(manifest.artifacts['requirement']).toBe('产物-requirement');
    expect(manifest.artifacts['design']).toBe('产物-design');
    expect(manifest.requirementId).toBe('req_ms5_e2e');
    expect(manifest.acceptance).toBe('pending');

    // ④ 用户验收 → acceptance=accepted
    const s3 = await orch.markDeliveryAccepted();
    expect(s3.deliveryAccepted).toBe(true);
    expect(s3.deliveryManifest!.acceptance).toBe('accepted');
  });
});
