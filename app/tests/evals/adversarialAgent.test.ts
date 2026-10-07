// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 对抗 Agent 形态 A（确定性半）契约用例 —— `.trae/specs/adversarial-agent-form-a.md`
//
// 覆盖：提案解析（非法项丢弃）· 机械裁决（闭集内/外）· 确定性（同输入同输出）·
//       合并 cheatReport（unmachineable 不冒充结论）· 提案器输入**不含隐藏期望值**（§8 风险3）·
//       N1 守住（exposed 不触发 fail-closed，模块本身无 exit/throw 副作用）。

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adversarialTargets,
  adversarialToCheatFindings,
  buildProposerInput,
  dedupeProposalsById,
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
    // 闭集外改用 C-99（C-9 自 2026-10-08 起已是**闭集内的**路径改写向量）
    const proposals = [p('P-1', 'C-1'), p('P-2', 'C-99'), p('P-3', 'C-3')];
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

/**
 * D-244③（2026-10-08）：离线提案集 fixture ⇒ **端到端可复现**。
 *
 * 此前"可复现"只有**构造保证**（机械裁决是纯函数）—— 没有真实 fixture 走完
 * "解析 → 唯一性守卫 → 裁决 → 并表"整链。本块以 fixture 文件（即 `--adversarial-proposals=<file>`
 * 的输入形态）驱动全链，**零模型**，断言输出**逐条可复现**。
 */
describe('D-244③：离线提案集 fixture ⇒ 端到端可复现（零模型）', () => {
  const FIXTURE = join(
    import.meta.dir,
    'fixtures',
    'adversarial-proposals.sample.json'
  );

  it('全链（解析 → 守卫 → 裁决 → 并表）输出稳定且符合闭集语义', () => {
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as unknown;
    const parsed = parseAdversarialProposals(raw);
    expect(parsed.rejected).toEqual([]); // fixture 全项合法
    const { proposals, duplicates } = dedupeProposalsById(parsed.proposals);
    expect(duplicates).toEqual([]); // fixture 的 id 本就唯一

    const a = runAdversarialPhase({ ctx: makeCtx(), proposals });
    const b = runAdversarialPhase({ ctx: makeCtx(), proposals });
    expect(a).toEqual(b); // 同输入 ⇒ 逐条相同（可复现）

    // 闭集内 ⇒ 复用形态 B 判据（含新增的路径改写向量 C-6/C-8）；闭集外（C-99）⇒ unmachineable（不臆断为漏洞）
    expect(a.verdicts.map((v) => `${v.proposalId}:${v.kind}`)).toEqual([
      'P-1:blocked',
      'P-2:blocked',
      'P-3:knownGap',
      'P-4:unmachineable',
    ]);
    // 并入 cheatReport：键唯一且含 A- 前缀；unmachineable 不转 finding
    expect(adversarialToCheatFindings(a).map((f) => f.id)).toEqual([
      'A-P-1',
      'A-P-2',
      'A-P-3',
    ]);
  });

  it('D-244③b 唯一性守卫：重复 id 保留首次、回传重复项（并入后键不撞）', () => {
    const { proposals, duplicates } = dedupeProposalsById([
      p('P-1', 'C-1'),
      p('P-2', 'C-3'),
      p('P-1', 'C-5'), // 与首条撞 id
    ]);
    expect(proposals.map((x) => x.id)).toEqual(['P-1', 'P-2']);
    expect(duplicates).toEqual(['P-1']);

    // 守卫后并入 cheatReport：A-P-* 键唯一（修复前 P-1 两条 ⇒ A-P-1 撞键、byId 错配）
    const ids = adversarialToCheatFindings(
      runAdversarialPhase({ ctx: makeCtx(), proposals })
    ).map((f) => f.id);
    expect(ids).toEqual(['A-P-1', 'A-P-2']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
