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
} from '../../src/query/patternAssembler.js';
import type { PatternAssemblerId } from '../../src/core/patterns/types.js';
import { VerifierAgent } from '../../src/query/VerifierAgent.js';

function selection(assembler: PatternAssemblerId): never {
  return {
    descriptor: { assembly: { assembler } },
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

  it('无运行时者仍如实 unavailable（不臆造）', () => {
    for (const id of ['iterative_refine', 'parallel_distributed'] as const) {
      const r = instantiatePattern(selection(id));
      expect(r.status).toBe('unavailable');
      if (r.status !== 'unavailable') continue;
      expect(r.reason.length).toBeGreaterThan(0);
    }
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
});
