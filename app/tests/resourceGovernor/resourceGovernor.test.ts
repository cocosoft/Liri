// MIT License
// Copyright (c) 2026 190615273@qq.com
// 跨会话资源治理用例（A5，2026-10-05）：准入/在飞视图/上限观测/开关零变更

import { afterEach, describe, expect, it } from 'bun:test';
import {
  DEFAULT_MAX_INFLIGHT_SESSIONS,
  ResourceGovernor,
  getResourceGovernor,
  resetResourceGovernorForTest,
} from '@modules/resourceGovernor';

const ENV = 'FEATURE_RESOURCE_GOVERNOR';
const ORIGINAL = process.env[ENV];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV];
  else process.env[ENV] = ORIGINAL;
  resetResourceGovernorForTest();
});

describe('ResourceGovernor：开关关闭 ⇒ 零行为变更（默认关）', () => {
  it('admit 恒放行且不登记；snapshot 为空；release 返回 false', () => {
    delete process.env[ENV];
    const gov = new ResourceGovernor();
    const d = gov.admit({ sessionId: 's1', priority: 'interactive' });
    expect(d.admitted).toBe(true);
    expect(d.overLimit).toBe(false);
    expect(d.inFlightCount).toBe(0);
    expect(gov.count()).toBe(0);
    expect(gov.snapshot()).toEqual([]);
    expect(gov.release('s1')).toBe(false);
  });
});

describe('ResourceGovernor：开关开启 ⇒ 在飞视图 + 上限仅观测', () => {
  it('admit 登记在飞；snapshot 含 priority/startedAt；release 移除', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor();
    const d = gov.admit({ sessionId: 's1', priority: 'background' });
    expect(d.admitted).toBe(true);
    expect(d.inFlightCount).toBe(1);
    const snap = gov.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.sessionId).toBe('s1');
    expect(snap[0]?.priority).toBe('background');
    expect(typeof snap[0]?.startedAt).toBe('number');

    expect(gov.release('s1')).toBe(true);
    expect(gov.release('s1')).toBe(false);
    expect(gov.snapshot()).toEqual([]);
  });

  it('同 sessionId 重复准入幂等（不重复登记，保留首次 startedAt）', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor();
    gov.admit({ sessionId: 's1', priority: 'interactive' });
    const first = gov.snapshot()[0]!.startedAt;
    gov.admit({ sessionId: 's1', priority: 'interactive' });
    expect(gov.snapshot()).toHaveLength(1);
    expect(gov.snapshot()[0]!.startedAt).toBe(first);
  });

  it('超过上限 ⇒ overLimit=true 且**仍放行**（仅告警不拦截）', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 1 });
    expect(gov.limit).toBe(1);
    const a = gov.admit({ sessionId: 's1', priority: 'interactive' });
    expect(a.overLimit).toBe(false);
    const b = gov.admit({ sessionId: 's2', priority: 'background' });
    expect(b.inFlightCount).toBe(2);
    expect(b.overLimit).toBe(true);
    // 关键：超限**不拦截**
    expect(b.admitted).toBe(true);
  });

  it('snapshot 按准入时间升序（先到先出视图）', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor();
    gov.admit({ sessionId: 's1', priority: 'interactive' });
    gov.admit({ sessionId: 's2', priority: 'background' });
    const ids = gov.snapshot().map((e) => e.sessionId);
    expect(ids).toEqual(['s1', 's2']);
  });

  it('reset 清空在飞', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor();
    gov.admit({ sessionId: 's1', priority: 'interactive' });
    gov.reset();
    expect(gov.snapshot()).toEqual([]);
  });

  it('非法 maxInflight ⇒ 回退默认（不静默成 0）', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 0 });
    expect(gov.limit).toBe(DEFAULT_MAX_INFLIGHT_SESSIONS);
  });
});

describe('ResourceGovernor：全局单例', () => {
  it('get 返回同一实例；resetForTest 后重建', () => {
    const a = getResourceGovernor();
    expect(getResourceGovernor()).toBe(a);
    resetResourceGovernorForTest();
    expect(getResourceGovernor()).not.toBe(a);
  });
});

describe('ResourceGovernor：O2 读数（与开关无关；`/v1/diagnostics/resource-governor` 数据源）', () => {
  it('开关关 ⇒ 仍观测峰值与撞限次数，但在飞视图恒空（零行为变更）', () => {
    delete process.env[ENV];
    const gov = new ResourceGovernor({ maxInflight: 2 });
    expect(gov.enabled).toBe(false);

    gov.admit({ sessionId: 's1', priority: 'interactive' }); // current=1
    gov.admit({ sessionId: 's2', priority: 'interactive' }); // current=2 ⇒ 撞限 1
    gov.admit({ sessionId: 's3', priority: 'interactive' }); // current=3 ⇒ 撞限 2

    expect(gov.observedPeakInflight).toBe(3);
    expect(gov.observedLimitHits).toBe(2);
    expect(gov.count()).toBe(0);
    expect(gov.snapshot()).toEqual([]);
  });

  it('开关开 ⇒ enabled=true；撞限按**准入次数**计（与日志条数同口径）', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 2 });
    expect(gov.enabled).toBe(true);

    gov.admit({ sessionId: 's1', priority: 'interactive' });
    gov.admit({ sessionId: 's2', priority: 'interactive' }); // 撞限 1
    gov.admit({ sessionId: 's2', priority: 'interactive' }); // 仍在飞 2 ⇒ 撞限 2

    expect(gov.count()).toBe(2);
    expect(gov.observedPeakInflight).toBe(2);
    expect(gov.observedLimitHits).toBe(2);
  });

  it('reset 一并清零峰值与撞限次数', () => {
    const gov = new ResourceGovernor({ maxInflight: 1 });
    gov.admit({ sessionId: 's1', priority: 'interactive' });
    gov.admit({ sessionId: 's2', priority: 'interactive' });
    expect(gov.observedLimitHits).toBeGreaterThan(0);

    gov.reset();
    expect(gov.observedPeakInflight).toBe(0);
    expect(gov.observedLimitHits).toBe(0);
  });
});
