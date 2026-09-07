// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * CompetitiveStrategyOrchestrator harness（P0-3，2026-09-06，Teamwork P1 批次）
 *
 * 验证候选生成 + 对抗批评 + 收敛语义（验收 #3）：fake callModel 模拟候选生成与
 * VerifierAgent 批评（按系统提示判别角色），不触网。覆盖：
 *  - 通过候选被 BEST_SELECTION 收敛、被驳候选 objection 保留（失败路线不丢）
 *  - 全部被驳 → 无收敛内容但 objection 全保留
 *  - 候选生成全部失败 → 不进入批评，空结果（无假数据）
 */
import { describe, expect, it } from 'bun:test';
import { CompetitiveStrategyOrchestrator } from '../../src/query/CompetitiveStrategyOrchestrator';
import type { ResearchCallModel } from '../../src/query/CompetitiveStrategyOrchestrator';

const TASK = '研究：对比两种方案在多语言产品本地化中的可行性并给出选型建议';

/** 构造角色判别型 fake callModel（候选生成器 / 严格审查员 system 前缀判别） */
function makeCallModel(opts: {
  approve?: string[];
  texts?: Record<string, string>;
  emptyGen?: boolean;
}): ResearchCallModel {
  return async function* (messages) {
    const sys = messages.find((m) => m.role === 'system')?.content ?? '';
    const usr = [...messages]
      .reverse()
      .find((m) => m.role === 'user')?.content ?? '';
    if (sys.includes('候选生成器')) {
      // 候选生成调用：按视角判别 agentId（user prompt 含"视角要求：…"）
      if (opts.emptyGen) return; // 不 yield → 生成失败
      const agentId = usr.includes('反例攻击视角')
        ? 'candidate_adversarial'
        : 'candidate_tradeoff';
      const content =
        opts.texts?.[agentId] ??
        `${agentId} 本地化候选方案：统一术语表、语言标记隔离、回归对照清单与发布排期。`;
      yield { content };
      return;
    }
    // VerifierAgent 批评调用：从 prompt 提取被审候选 toolCallId（"candidate_proposal(<id>)"）
    const m = usr.match(/candidate_proposal\(([a-z_]+)\)/);
    const reviewedId = m?.[1] ?? '';
    const reviewed = opts.approve ?? [];
    if (reviewed.includes(reviewedId)) {
      yield {
        content: JSON.stringify({
          verdict: 'APPROVE',
          confidence: 0.9,
          feedback: '',
          checks: [],
        }),
      };
    } else {
      yield {
        content: JSON.stringify({
          verdict: 'REJECT',
          confidence: 0.2,
          feedback: '未覆盖小众语言方向\n术语表维护成本被低估',
          checks: [],
        }),
      };
    }
  };
}

function makeOrch(callModel: ResearchCallModel): CompetitiveStrategyOrchestrator {
  return new CompetitiveStrategyOrchestrator({
    callModel,
    perspectiveCount: 2,
  });
}

describe('CompetitiveStrategyOrchestrator — 候选生成 + 对抗批评（P0-3）', () => {
  it('通过候选被收敛、被驳候选 objection 保留（验收 #3 主路径）', async () => {
    const orch = makeOrch(
      makeCallModel({ approve: ['candidate_tradeoff'] })
    );
    const res = await orch.run(TASK, new AbortController().signal);

    expect(res.success).toBe(true);
    expect(res.candidates.length).toBe(2); // 两份候选（全局权衡 + 反例攻击）
    expect(res.approved.length).toBe(1);
    expect(res.approved[0].agentId).toBe('candidate_tradeoff');
    expect(res.content).toContain('candidate_tradeoff');
    // 被驳候选失败路线保留：objection 蒸馏自 REJECT feedback
    expect(res.rejected.length).toBe(1);
    expect(res.rejected[0].agentId).toBe('candidate_adversarial');
    expect(res.rejected[0].objections.length).toBeGreaterThanOrEqual(2);
    expect(res.rejected[0].objections.join('')).toContain('未覆盖小众语言方向');
  });

  it('全部候选被驳：无收敛内容但 objection 全保留（失败路线不丢）', async () => {
    const orch = makeOrch(makeCallModel({ approve: [] }));
    const res = await orch.run(TASK, new AbortController().signal);

    expect(res.success).toBe(false);
    expect(res.content).toBe('');
    expect(res.approved.length).toBe(0);
    expect(res.rejected.length).toBe(2); // 每份候选都带 objection
    for (const r of res.rejected) {
      expect(r.objections.length).toBeGreaterThan(0);
    }
    expect(res.stats.rejectedCount).toBe(2);
  });

  it('候选生成全部失败：不进入批评，返回空结果（零假数据）', async () => {
    const orch = makeOrch(makeCallModel({ emptyGen: true }));
    const res = await orch.run(TASK, new AbortController().signal);

    expect(res.candidates.length).toBe(0);
    expect(res.success).toBe(false);
    expect(res.content).toBe('');
    expect(res.rejected.length).toBe(0);
    expect(res.stats.candidateCount).toBe(0);
  });

  it('P3 role 路由：注入 generatorCallModel 后候选生成走专用模型（验收 #6 消费端闭环）', async () => {
    // 批评仍走 base（verifier 未注入 → 回退 callModel）；生成注入带 [GEN-ROLE] 标记的专用模型
    const base = makeCallModel({ approve: ['candidate_tradeoff'] });
    const genRole: ResearchCallModel = async function* (messages) {
      const usr = [...messages]
        .reverse()
        .find((m) => m.role === 'user')?.content ?? '';
      const agentId = usr.includes('反例攻击视角')
        ? 'candidate_adversarial'
        : 'candidate_tradeoff';
      yield {
        content: `${agentId} [GEN-ROLE] 本地化候选：统一术语表、语言标记隔离、回归对照清单。`,
      };
      return;
    };
    const orch = new CompetitiveStrategyOrchestrator({
      callModel: base,
      generatorCallModel: genRole,
      perspectiveCount: 2,
    });
    const res = await orch.run(TASK, new AbortController().signal);

    expect(res.success).toBe(true);
    // 收敛正文源自被批准候选内容——含 [GEN-ROLE] 标记即证明生成确实走了 generatorCallModel
    expect(res.content).toContain('[GEN-ROLE]');
    expect(res.approved.length).toBe(1);
  });
});
