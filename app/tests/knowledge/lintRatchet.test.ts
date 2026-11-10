// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * C4（2026-11-05）：知识库编译产物 lint 错误数棘轮。
 *
 * 背景：`KnowledgeCompiler` 的编译后 lint 只 `logger.warn` 打印数字（真机 9 298 个 error），
 * 结果没人看、也不阻断任何流程。现改为「只减不增」：
 *   - 首轮以当前错误数为基线（不因存量历史错误阻断）；
 *   - 高于基线 ⇒ 判本次编译失败（写入 `CompileResult.errors`）；
 *   - 低于基线 ⇒ 基线下调锁定。
 *
 * 本用例只锁**纯判定函数**（`decideLintRatchet`），不跑真实编译。
 */
import { describe, it, expect } from 'bun:test';
import {
  buildLintRatchetSnapshot,
  decideLintRatchet,
} from '../../src/knowledge/KnowledgeCompiler.js';

describe('decideLintRatchet — lint 错误数棘轮判定', () => {
  it('无基线（首轮 / 旧状态文件）⇒ 采纳当前值为基线，不阻断', () => {
    expect(decideLintRatchet(9298, undefined)).toEqual({
      action: 'adopted',
      baseline: 9298,
    });
  });

  it('高于基线 ⇒ exceeded，且基线保持不变（只减不增）', () => {
    expect(decideLintRatchet(101, 100)).toEqual({
      action: 'exceeded',
      baseline: 100,
    });
  });

  it('低于基线 ⇒ lowered，携带旧基线便于留痕', () => {
    expect(decideLintRatchet(99, 100)).toEqual({
      action: 'lowered',
      previous: 100,
      baseline: 99,
    });
  });

  it('等于基线 ⇒ unchanged（不写状态、不下调）', () => {
    expect(decideLintRatchet(100, 100)).toEqual({
      action: 'unchanged',
      baseline: 100,
    });
  });

  it('脏基线（负数 / NaN）⇒ 视为无基线，重新采纳', () => {
    expect(decideLintRatchet(5, -1)).toEqual({
      action: 'adopted',
      baseline: 5,
    });
    expect(decideLintRatchet(5, Number.NaN)).toEqual({
      action: 'adopted',
      baseline: 5,
    });
  });

  it('脏当前值（负数 / NaN / 小数）⇒ 归一到非负整数', () => {
    expect(decideLintRatchet(-3, 0)).toEqual({
      action: 'unchanged',
      baseline: 0,
    });
    expect(decideLintRatchet(Number.NaN, 0)).toEqual({
      action: 'unchanged',
      baseline: 0,
    });
    expect(decideLintRatchet(2.9, 0)).toEqual({
      action: 'exceeded',
      baseline: 0,
    });
  });

  it('基线为 0 时任何新增错误都阻断（清零后的严格档）', () => {
    expect(decideLintRatchet(0, 0)).toEqual({
      action: 'unchanged',
      baseline: 0,
    });
    expect(decideLintRatchet(1, 0)).toEqual({
      action: 'exceeded',
      baseline: 0,
    });
  });
});

/**
 * C4（2026-11-10）：`/v1/knowledge/health` 暴露的棘轮快照。
 *
 * 口径要点：健康巡检**只读**——`baseline` 始终是状态文件里已存的基线（不因
 * "当前更低"而提前下调），`status` 才表达"下次编译会下调"。
 */
describe('buildLintRatchetSnapshot — 健康巡检读到的棘轮快照', () => {
  it('从未编译（无基线 / 脏基线）⇒ baseline=null、status=no_baseline', () => {
    const expected = {
      errors: 7,
      warnings: 3,
      baseline: null,
      status: 'no_baseline',
    };
    for (const dirty of [undefined, null, Number.NaN, -1, '100', {}]) {
      expect(buildLintRatchetSnapshot(7, 3, dirty)).toEqual(expected);
    }
  });

  it('高于基线 ⇒ exceeded，baseline 保持旧值（只读，不改棘轮）', () => {
    expect(buildLintRatchetSnapshot(101, 4, 100)).toEqual({
      errors: 101,
      warnings: 4,
      baseline: 100,
      status: 'exceeded',
    });
  });

  it('低于基线 ⇒ lowered，baseline 仍是旧值（下调留给下次编译）', () => {
    expect(buildLintRatchetSnapshot(99, 4, 100)).toEqual({
      errors: 99,
      warnings: 4,
      baseline: 100,
      status: 'lowered',
    });
  });

  it('等于基线 ⇒ unchanged', () => {
    expect(buildLintRatchetSnapshot(100, 0, 100)).toEqual({
      errors: 100,
      warnings: 0,
      baseline: 100,
      status: 'unchanged',
    });
  });

  it('脏计数（负数 / NaN / 小数）⇒ 归一到非负整数（与棘轮判定同口径）', () => {
    expect(buildLintRatchetSnapshot(-3, Number.NaN, 0)).toEqual({
      errors: 0,
      warnings: 0,
      baseline: 0,
      status: 'unchanged',
    });
    expect(buildLintRatchetSnapshot(2.9, 1.2, 2)).toEqual({
      errors: 2,
      warnings: 1,
      baseline: 2,
      status: 'unchanged',
    });
  });
});
