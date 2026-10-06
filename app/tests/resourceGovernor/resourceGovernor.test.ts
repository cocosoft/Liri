// MIT License
// Copyright (c) 2026 190615273@qq.com
// 跨会话资源治理用例（A5，2026-10-05）：准入/在飞视图/上限观测/开关零变更

import { afterEach, describe, expect, it } from 'bun:test';
import {
  DEFAULT_MAX_INFLIGHT_SESSIONS,
  ResourceGovernor,
  getResourceGovernor,
  resetResourceGovernorForTest,
} from '../../src/resourceGovernor/index';

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
