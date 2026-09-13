/**
 * EffectScope 性能基准测试（方案 §6 性能预算）
 *
 * 预算：EffectScope 单次 effect 登记 + dispose 全链释放 ≤ 10ms。
 * 纳入基准测试防回归；超预算即 FAIL（性能预算为 MUST 级验收）。
 */

import { describe, test, expect } from 'bun:test';
import { EffectScope } from '../EffectScope.js';

const BUDGET_MS = 10;

describe('EffectScope 性能基准', () => {
  test('单次 effect 登记 + dispose 全链释放 ≤ 10ms', async () => {
    const scope = new EffectScope();
    // 登记 3 个逆操作（模拟沙箱→文件→abort 典型链）
    scope.onDispose(() => {});
    scope.onDispose(() => {});
    scope.onDispose(() => {});

    const start = performance.now();
    await scope.effect(async () => {
      // 作用域内执行空操作
    });
    await scope.dispose();
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThanOrEqual(BUDGET_MS);
  });

  test('空作用域 dispose 耗时 ≤ 10ms', async () => {
    const scope = new EffectScope();
    const start = performance.now();
    await scope.dispose();
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThanOrEqual(BUDGET_MS);
  });
});
