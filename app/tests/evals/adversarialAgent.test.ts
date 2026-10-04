// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 对抗 Agent 形态 A（确定性半）契约用例 —— `.trae/specs/adversarial-agent-form-a.md`
//
// 覆盖：提案解析（非法项丢弃）· 机械裁决（闭集内/外）· 确定性（同输入同输出）·
//       合并 cheatReport（unmachineable 不冒充结论）· 提案器输入**不含隐藏期望值**（§8 风险3）·
//       N1 守住（exposed 不触发 fail-closed，模块本身无 exit/throw 副作用）。

import { describe, expect, it } from 'bun:test';
import {
  adversarialTargets,
  adversarialToCheatFindings,
  buildProposerInput,
  judgeProposal,
  parseAdversarialProposals,
  runAdversarialPhase,
  type AdversarialProposal,
} from '../../src/evals/adversarialAgent';
import {
  auditAntiCheatSurface,
  type AntiCheatContext,
} from '../../src/evals/antiCheatAudit';

/** 干净基线：报告目录已屏蔽、声明=生效、bash 无内核约束 */
const makeCtx = (over: Partial<AntiCheatContext> = {}): AntiCheatContext => ({
  declaredShields: ['/x/report'],
  appliedShields: ['/x/report'],
  reportDir: '/x/report',
  sandboxRoot: '/tmp/liri-eval-1',
  platform: 'linux',
  bashLandlockEnabled: false,
  tmpRoot: '/tmp',
  ...over,
});

const p = (id: string, target: string): AdversarialProposal => ({
  id,
  target,
  steps: [],
  expectation: `尝试绕过 ${target}`,
});

describe('对抗提案解析（宽松校验：非法项丢弃，不抛错）', () => {
  it('合法项保留、缺字段项回传原因', () => {
    const { proposals, rejected } = parseAdversarialProposals([
      { id: 'P-1', target: 'C-1', steps: ['x'], expectation: 'e' },
      { target: 'C-2' }, // 缺 id
      { id: 'P-3' }, // 缺 target
      'not-an-object',
    ]);
    expect(proposals.map((x) => x.id)).toEqual(['P-1']);
    expect(rejected.length).toBe(3);
    expect(rejected[1]).toContain('target');
  });

  it('顶层非数组 ⇒ 全量拒绝（不臆造）', () => {
    const { proposals, rejected } = parseAdversarialProposals({ id: 'P-1' });
    expect(proposals).toEqual([]);
    expect(rejected).toEqual(['顶层不是数组']);
  });
});

describe('机械裁决（闭集内 ⇒ 复用形态 B 判据；闭集外 ⇒ unmachineable）', () => {
  it('target ∈ 闭集 ⇒ 取该向量的裁决（blocked / knownGap）', () => {
    const audit = auditAntiCheatSurface(makeCtx());
    // 干净基线：C-1/C-2 已挡，C-3/C-4/C-5 已知缺口
    expect(judgeProposal(p('P-1', 'C-1'), audit).kind).toBe('blocked');
    expect(judgeProposal(p('P-2', 'C-3'), audit).kind).toBe('knownGap');
  });

  it('target ∉ 闭集 ⇒ unmachineable，且 detail 列出闭集', () => {
    const audit = auditAntiCheatSurface(makeCtx());
    const v = judgeProposal(p('P-9', 'C-99'), audit);
    expect(v.kind).toBe('unmachineable');
    expect(v.detail).toContain('C-1');
  });

  it('闭集由既有判据派生（单一事实源，不手写第二份清单）', () => {
    const audit = auditAntiCheatSurface(makeCtx());
    expect(adversarialTargets(audit).map((t) => t.id)).toEqual(
      audit.findings.map((f) => f.id)
    );
  });
});

describe('提案相位：确定性 + N1（exposed 不触发 fail-closed）', () => {
  it('同一提案集 ⇒ 裁决逐条相同（可复现）', () => {
    const ctx = makeCtx();
    const proposals = [p('P-1', 'C-1'), p('P-2', 'C-9'), p('P-3', 'C-3')];
    const a = runAdversarialPhase({ ctx, proposals });
    const b = runAdversarialPhase({ ctx, proposals });
    expect(a.verdicts).toEqual(b.verdicts);
    expect(a.unmachineable.map((v) => v.proposalId)).toEqual(['P-2']);
    expect(a.knownGaps.map((v) => v.proposalId)).toEqual(['P-3']);
  });

  it('N1：exposed 提案照常返回（模块无 exit/throw 副作用）', () => {
    // 报告目录未屏蔽 ⇒ C-1 必挡未挡（exposed）
    const ctx = makeCtx({
      declaredShields: ['/other'],
      appliedShields: ['/other'],
      reportDir: '/x/report',
    });
    const report = runAdversarialPhase({
      ctx,
      proposals: [p('P-1', 'C-1')],
    });
    expect(report.exposed.map((v) => v.proposalId)).toEqual(['P-1']);
    expect(report.verdicts[0].kind).toBe('exposed');
  });
});

describe('D1=(b)：并入同一 cheatReport', () => {
  it('unmachineable **不**转 finding；其余按 CheatFinding 形状（id 前缀 A-）', () => {
    const ctx = makeCtx();
    const report = runAdversarialPhase({
      ctx,
      proposals: [p('P-1', 'C-1'), p('P-2', 'C-3'), p('P-3', 'C-99')],
    });
    const findings = adversarialToCheatFindings(report);
    expect(findings.map((f) => f.id)).toEqual(['A-P-1', 'A-P-2']);
    expect(findings.map((f) => f.verdict)).toEqual(['blocked', 'knownGap']);
    expect(findings[0].title).toContain('C-1');
    expect(findings[0].detail).toContain('target=C-1');
  });
});

describe('提案器输入（安全面：不含隐藏期望值）', () => {
  it('只含 declaredShields + targets（无 expectation / 无参考解）', () => {
    const input = buildProposerInput(makeCtx());
    expect(Object.keys(input).sort()).toEqual(['declaredShields', 'targets']);
    expect(input.declaredShields).toEqual(['/x/report']);
    expect(input.targets.length).toBeGreaterThan(0);
  });
});
