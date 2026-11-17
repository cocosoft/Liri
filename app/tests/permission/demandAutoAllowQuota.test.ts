// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B3 余项（2026-11-17）：demand 自动放行的**每会话配额**与**摘要计数**。
 *
 * 锁四件事：
 * 1. 默认值 = 0（不限）⇒ 默认行为逐字不变；脏值 / 负数 / 非整数一律回落 0；
 * 2. 配了上限则**按会话**计数，用尽后返回 `allowed:false`（调用方回落 ask）；
 * 3. 会话之间互不影响；无会话 id（后台 / 无人值守）不计数也不限流；
 * 4. 计数按工具聚合，供周期摘要与诊断读取。
 */
import { describe, expect, it } from 'bun:test';

import {
  consumeDemandAutoAllow,
  DEFAULT_DEMAND_AUTO_ALLOW_MAX,
  DEMAND_AUTO_ALLOW_SUMMARY_STEP,
  ENV_DEMAND_AUTO_ALLOW_MAX,
  getDemandAutoAllowStats,
  MAX_DEMAND_AUTO_ALLOW_QUOTA,
  readDemandAutoAllowMax,
  resetDemandAutoAllowQuota,
  resolveDemandAutoAllowMax,
} from '../../../packages/infra/src/permission/demandAutoAllowQuota';

describe('resolveDemandAutoAllowMax（纯函数）', () => {
  it('缺省 / 脏值 / 负数 / 非整数 ⇒ 0（不限）', () => {
    for (const raw of [
      undefined,
      null,
      '',
      '   ',
      'abc',
      -5,
      0,
      NaN,
      Infinity,
    ]) {
      expect(resolveDemandAutoAllowMax(raw)).toBe(0);
    }
  });

  it('正数取整；字符串数字可解析；超上限夹到上限', () => {
    expect(resolveDemandAutoAllowMax(3)).toBe(3);
    expect(resolveDemandAutoAllowMax(3.9)).toBe(3);
    expect(resolveDemandAutoAllowMax('7')).toBe(7);
    expect(resolveDemandAutoAllowMax(MAX_DEMAND_AUTO_ALLOW_QUOTA + 1)).toBe(
      MAX_DEMAND_AUTO_ALLOW_QUOTA
    );
  });

  it('环境变量优先于配置（`0` = 显式不限）', () => {
    const env = { [ENV_DEMAND_AUTO_ALLOW_MAX]: '2' } as NodeJS.ProcessEnv;
    expect(readDemandAutoAllowMax(env)).toBe(2);
    const zero = { [ENV_DEMAND_AUTO_ALLOW_MAX]: '0' } as NodeJS.ProcessEnv;
    expect(readDemandAutoAllowMax(zero)).toBe(DEFAULT_DEMAND_AUTO_ALLOW_MAX);
  });
});

describe('consumeDemandAutoAllow（每会话计数 + 配额）', () => {
  it('默认不限（limit=0）⇒ 一直放行，计数递增', () => {
    resetDemandAutoAllowQuota();
    const first = consumeDemandAutoAllow({
      sessionId: 's1',
      toolName: 'bash',
      limit: 0,
    });
    const second = consumeDemandAutoAllow({
      sessionId: 's1',
      toolName: 'bash',
      limit: 0,
    });
    expect(first.allowed).toBe(true);
    expect(first.count).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.count).toBe(2);
  });

  it('配了上限 ⇒ 用尽后返回 allowed:false（不抛错、不静默清零）', () => {
    resetDemandAutoAllowQuota();
    expect(
      consumeDemandAutoAllow({ sessionId: 's2', toolName: 'bash', limit: 2 })
        .allowed
    ).toBe(true);
    expect(
      consumeDemandAutoAllow({ sessionId: 's2', toolName: 'bash', limit: 2 })
        .allowed
    ).toBe(true);
    const third = consumeDemandAutoAllow({
      sessionId: 's2',
      toolName: 'bash',
      limit: 2,
    });
    expect(third.allowed).toBe(false);
    expect(third.count).toBe(2);
    expect(third.limit).toBe(2);
  });

  it('会话之间互不影响；无会话 id ⇒ 不计数也不限流', () => {
    resetDemandAutoAllowQuota();
    consumeDemandAutoAllow({ sessionId: 'a', toolName: 'bash', limit: 1 });
    // 同会话第二次被限流
    expect(
      consumeDemandAutoAllow({ sessionId: 'a', toolName: 'bash', limit: 1 })
        .allowed
    ).toBe(false);
    // 另一个会话不受影响
    expect(
      consumeDemandAutoAllow({ sessionId: 'b', toolName: 'bash', limit: 1 })
        .allowed
    ).toBe(true);
    // 无会话 id：放行且不计数
    const anonymous = consumeDemandAutoAllow({
      sessionId: null,
      toolName: 'bash',
      limit: 1,
    });
    expect(anonymous.allowed).toBe(true);
    expect(anonymous.count).toBe(0);
  });

  it('按工具聚合计数（摘要载荷的数据源）', () => {
    resetDemandAutoAllowQuota();
    for (const toolName of ['bash', 'bash', 'powershell']) {
      consumeDemandAutoAllow({ sessionId: 's3', toolName, limit: 0 });
    }
    expect(getDemandAutoAllowStats('s3')).toEqual({
      count: 3,
      byTool: { bash: 2, powershell: 1 },
    });
    // 未跟踪的会话 ⇒ 空快照（不编造 0 以外的值）
    expect(getDemandAutoAllowStats('nope')).toEqual({ count: 0, byTool: {} });
  });

  it('累计到摘要步长时计数仍准确（摘要只落日志，不改判定）', () => {
    resetDemandAutoAllowQuota();
    for (let i = 0; i < DEMAND_AUTO_ALLOW_SUMMARY_STEP; i += 1) {
      const result = consumeDemandAutoAllow({
        sessionId: 's4',
        toolName: 'bash',
        limit: 0,
      });
      expect(result.allowed).toBe(true);
    }
    expect(getDemandAutoAllowStats('s4').count).toBe(
      DEMAND_AUTO_ALLOW_SUMMARY_STEP
    );
  });

  it('reset 后计数清零', () => {
    resetDemandAutoAllowQuota();
    consumeDemandAutoAllow({ sessionId: 's5', toolName: 'bash', limit: 0 });
    resetDemandAutoAllowQuota();
    expect(getDemandAutoAllowStats('s5').count).toBe(0);
  });
});
