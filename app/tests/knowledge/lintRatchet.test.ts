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
import { decideLintRatchet } from '../../src/knowledge/KnowledgeCompiler.js';

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
