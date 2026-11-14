// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 13-P1-3（2026-10-05）：装配结果携带**执行配方** + 配方→验证器配置 + 运行期配置更新。
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A1 —— 装配结果原只回答"是否走研究编排"
 * 一个布尔问题，不携带 Pattern 应有的执行配方；5 个模式中 4 个 `unavailable`。
 */
import { describe, it, expect } from 'bun:test';
import {
  instantiatePattern,
  verifierConfigForRecipe,
} from '@modules/query/patternAssembler.js';
import type { PatternAssemblerId } from '@modules/query/patterns';
import { VerifierAgent } from '@modules/query/VerifierAgent.js';

function selection(assembler: PatternAssemblerId, name?: string): never {
  return {
    descriptor: { assembly: { assembler }, ...(name ? { name } : {}) },
  } as unknown as never;
}

describe('instantiatePattern 携带执行配方（13-P1-3）', () => {
  it('competitive_strategy ⇒ ready + route:research + recipe（advisory/default）', () => {
    const r = instantiatePattern(selection('competitive_strategy'));
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.route).toBe('research');
    expect(r.recipe.loopKind).toBe('research');
    expect(r.recipe.verifyPolicy).toBe('advisory');
    expect(r.recipe.budgetPolicy).toBe('default');
  });

  it('**self_verify 由 unavailable 升为 ready**（复用既有 VerifierAgent）', () => {
    const r = instantiatePattern(selection('self_verify'));
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.route).toBe('verify');
    expect(r.recipe.loopKind).toBe('verify');
    expect(r.recipe.verifyPolicy).toBe('blocking');
    expect(r.recipe.budgetPolicy).toBe('strict');
  });

  // 2026-11-03（§13）：iterative_refine 并入验证线路 deep 档 ⇒ 不再是 unavailable
  it('仍未接线者如实 unavailable（不臆造）：parallel_distributed', () => {
    for (const id of ['parallel_distributed'] as const) {
      const r = instantiatePattern(selection(id));
      expect(r.status).toBe('unavailable');
      if (r.status !== 'unavailable') continue;
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('iterative_refine ⇒ ready/verify + deep 档（复用同一 route）', () => {
    const r = instantiatePattern(
      selection('iterative_refine', 'iterative_refine')
    );
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.route).toBe('verify');
    expect(r.recipe.intensity).toBe('deep');
  });

  it('ready 分支自描述**可达性 + 门控**（外部报告 G2 收口）', () => {
    const research = instantiatePattern(
      selection('competitive_strategy', 'competitive_strategy')
    );
    expect(research.status).toBe('ready');
    if (research.status !== 'ready') return;
    expect(research.reachable).toBe(true);

    const verify = instantiatePattern(selection('self_verify', 'self_verify'));
    expect(verify.status).toBe('ready');
    if (verify.status !== 'ready') return;
    expect(verify.reachable).toBe(true);
    expect(verify.featureGate?.flag).toBe('SELF_VERIFY_PATTERN');
    expect(typeof verify.featureGate?.enabled).toBe('boolean');
  });
});

describe('verifierConfigForRecipe（配方 → 既有验证器配置）', () => {
  const base = { loopKind: 'verify' as const };

  it('off ⇒ 关闭验证', () => {
    expect(
      verifierConfigForRecipe({
        ...base,
        verifyPolicy: 'off',
        budgetPolicy: 'default',
      })
    ).toEqual({ enabled: false, failClosed: true });
  });

  it('advisory ⇒ 启用但 fail-open（不阻断）', () => {
    expect(
      verifierConfigForRecipe({
        ...base,
        verifyPolicy: 'advisory',
        budgetPolicy: 'default',
      })
    ).toEqual({ enabled: true, failClosed: false });
  });

  it('blocking + strict ⇒ 启用 + fail-closed + 收紧循环上限', () => {
    expect(
      verifierConfigForRecipe({
        ...base,
        verifyPolicy: 'blocking',
        budgetPolicy: 'strict',
      })
    ).toEqual({ enabled: true, failClosed: true, maxCycles: 2 });
  });

  // 2026-11-03（§13）：deep = 多轮打磨档（原 iterative_refine）⇒ 更宽循环上限
  it('blocking + strict + deep ⇒ 放宽循环上限（多轮精修档），其余与 standard 相同', () => {
    expect(
      verifierConfigForRecipe({
        ...base,
        verifyPolicy: 'blocking',
        budgetPolicy: 'strict',
        intensity: 'deep',
      })
    ).toEqual({ enabled: true, failClosed: true, maxCycles: 4 });
  });

  it('intensity 只在 blocking 生效（off / advisory 不受影响）', () => {
    expect(
      verifierConfigForRecipe({
        ...base,
        verifyPolicy: 'advisory',
        budgetPolicy: 'strict',
        intensity: 'deep',
      })
    ).toEqual({ enabled: true, failClosed: false });
  });
});

describe('VerifierAgent.configure（运行期配方应用；行为可观测）', () => {
  const input = {
    messages: [{ role: 'user', content: 'do it' }],
    toolResults: [{ toolName: 'file_write', toolCallId: 't1', result: 'ok' }],
    turnCount: 1,
    sessionId: 's_recipe',
  };
  const signal = new AbortController().signal;

  it('configure({failClosed:false}) ⇒ 同一实例从 fail-closed 切到 fail-open', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    const before = await agent.verify(input, signal);
    expect(before.passed).toBe(false); // 无 callModel ⇒ fail-closed 不放行

    agent.configure({ failClosed: false }); // 应用 advisory 配方
    const after = await agent.verify(input, signal);
    expect(after.passed).toBe(true); // 旧 fail-open 行为
  });

  // 2026-11-03（缺口 #1）：门控关闭必须能**撤销**已知应用的配方（否则"关"不生效）
  it('resetConfig() ⇒ 撤销运行期配方，回到构造期配置', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.configure({ failClosed: false }); // 模拟门控开启时应用的配方
    expect((await agent.verify(input, signal)).passed).toBe(true);

    agent.resetConfig(); // 门控关闭 ⇒ 撤销
    expect((await agent.verify(input, signal)).passed).toBe(false);
  });
});
