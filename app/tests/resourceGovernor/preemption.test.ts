// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * P26-1 §9.2 跨会话**抢占**（D6=B：抢占 = 中止并丢弃）守卫（2026-10-07）
 *
 * 背景：阶段 1 的治理器**只观测不拦截**（`overLimit` 仅告警）；本批按用户裁定 D6=B 落地
 * 抢占：超限且存在**更低优先级**的**跨会话**在飞者 ⇒ 标记 `preempted` 并调用**注入回调**
 * （组合根装配 `chatManager.abortSessionStream`）。
 *
 * 本守卫锁五件事：
 *   ① **victim 规则**（纯函数）：不得同会话 / 只抢更低优先 / 幂等跳过已抢占 / 最低优先 + 同级最早；
 *   ② **抢占生效**：`preempted` 返回 + 条目标记 + 回调收到 (victim, requester)；
 *   ③ **幂等**：重复准入不重复抢占、不重复回调；
 *   ④ **未注入回调 ⇒ 退回"仅告警"**（阶段 1 行为，零变更）；
 *   ⑤ **开关关闭 ⇒ 零行为变更**（不登记 / 不抢占 / 不回调）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  ResourceGovernor,
  selectPreemptionVictim,
} from '../../src/resourceGovernor/index';
import type { InFlightEntry } from '../../src/resourceGovernor/index';

const ENV = 'FEATURE_RESOURCE_GOVERNOR';
const ORIGINAL = process.env[ENV];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV];
  else process.env[ENV] = ORIGINAL;
});

function entry(
  sessionId: string,
  priority: InFlightEntry['priority'],
  startedAt: number,
  preempted?: boolean
): InFlightEntry {
  return preempted === undefined
    ? { sessionId, priority, startedAt }
    : { sessionId, priority, startedAt, preempted };
}

describe('selectPreemptionVictim：victim 选择规则（纯函数）', () => {
  it('① 硬约束：不得抢占同会话（即便它优先级最低、最早）', () => {
    const victim = selectPreemptionVictim(
      [entry('me', 'background', 1)],
      'me',
      'interactive'
    );
    expect(victim).toBeUndefined();
  });

  it('② 只抢更低优先：background 请求者不得抢占 interactive 在飞者', () => {
    const victim = selectPreemptionVictim(
      [entry('user', 'interactive', 1)],
      'bg-job',
      'background'
    );
    expect(victim).toBeUndefined();
  });

  it('③ 幂等：已 preempted 者不再是候选', () => {
    const victim = selectPreemptionVictim(
      [entry('already', 'background', 1, true)],
      'newcomer',
      'interactive'
    );
    expect(victim).toBeUndefined();
  });

  it('④ 取优先级最低者', () => {
    const victim = selectPreemptionVictim(
      [
        entry('bg-old', 'background', 1),
        entry('bg-new', 'background', 2),
        entry('ui', 'interactive', 0),
      ],
      'newcomer',
      'interactive'
    );
    expect(victim?.sessionId).toBe('bg-old');
  });

  it('④ 同级取 startedAt 最早者', () => {
    const victim = selectPreemptionVictim(
      [
        entry('bg-later', 'background', 500),
        entry('bg-earlier', 'background', 100),
      ],
      'newcomer',
      'interactive'
    );
    expect(victim?.sessionId).toBe('bg-earlier');
  });

  it('无候选 ⇒ undefined', () => {
    expect(selectPreemptionVictim([], 'x', 'interactive')).toBeUndefined();
  });
});

describe('admit：超限抢占（开关开启 + 注入回调）', () => {
  it('interactive 到达且超限 ⇒ 抢占 background victim（返回 + 标记 + 回调）', () => {
    process.env[ENV] = 'true';
    const calls: Array<[string, string]> = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onPreempt: (victim, requester) => calls.push([victim, requester]),
    });

    gov.admit({ sessionId: 'bg-job', priority: 'background' });
    const d = gov.admit({ sessionId: 'user-ui', priority: 'interactive' });

    expect(d.overLimit).toBe(true);
    expect(d.admitted).toBe(true); // D4 语义未变：抢占不改变本次准入结果
    expect(d.preempted).toEqual(['bg-job']);
    expect(calls).toEqual([['bg-job', 'user-ui']]);

    // victim 仍留在飞（由 victim 自身的 release 移除）⇒ 标记可持续供 UI/日志区分
    const victimEntry = gov.snapshot().find((e) => e.sessionId === 'bg-job');
    expect(victimEntry?.preempted).toBe(true);
  });

  it('幂等：再次准入不重复抢占、不重复回调', () => {
    process.env[ENV] = 'true';
    const calls: string[] = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onPreempt: (victim) => calls.push(victim),
    });

    gov.admit({ sessionId: 'bg-job', priority: 'background' });
    gov.admit({ sessionId: 'user-ui', priority: 'interactive' });
    const again = gov.admit({ sessionId: 'user-2', priority: 'interactive' });

    // 'bg-job' 已标记 preempted ⇒ 跳过；'user-ui' 同级 ⇒ 不抢 ⇒ 无候选
    expect(again.preempted).toEqual([]);
    expect(calls).toEqual(['bg-job']);
  });

  it('background 到达且超限 ⇒ 不抢占 interactive（后台不挤占人工）', () => {
    process.env[ENV] = 'true';
    const calls: string[] = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onPreempt: (victim) => calls.push(victim),
    });

    gov.admit({ sessionId: 'user-ui', priority: 'interactive' });
    const d = gov.admit({ sessionId: 'bg-job', priority: 'background' });

    expect(d.overLimit).toBe(true);
    expect(d.preempted).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('未注入回调 ⇒ 退回阶段 1「仅告警」（preempted 恒空）', () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 1 });

    gov.admit({ sessionId: 'bg-job', priority: 'background' });
    const d = gov.admit({ sessionId: 'user-ui', priority: 'interactive' });

    expect(d.overLimit).toBe(true);
    expect(d.preempted).toEqual([]);
    expect(
      gov.snapshot().find((e) => e.sessionId === 'bg-job')?.preempted
    ).toBeUndefined();
  });
});

describe('admit：抢占事件下发（PC-2 观察者）', () => {
  it('抢占 ⇒ 观察者收到 victim 的 preempted 事件（仅一条）', () => {
    process.env[ENV] = 'true';
    const events: Array<{ sessionId: string; state: string }> = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onPreempt: () => {},
      onEvent: (e) => events.push({ sessionId: e.sessionId, state: e.state }),
    });

    gov.admit({ sessionId: 'bg-job', priority: 'background' });
    gov.admit({ sessionId: 'user-ui', priority: 'interactive' });

    expect(events).toEqual([{ sessionId: 'bg-job', state: 'preempted' }]);
  });

  it('未抢占（无候选 / 未注入回调）⇒ 下发空', () => {
    process.env[ENV] = 'true';
    const events: string[] = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onEvent: (e) => events.push(e.state),
    });

    gov.admit({ sessionId: 'user-ui', priority: 'interactive' });
    gov.admit({ sessionId: 'bg-job', priority: 'background' });

    expect(events).toEqual([]);
  });

  it('开关关闭 ⇒ 不下发（零行为变更）', () => {
    delete process.env[ENV];
    const events: string[] = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onPreempt: () => {},
      onEvent: (e) => events.push(e.state),
    });

    gov.admit({ sessionId: 'bg-job', priority: 'background' });
    gov.admit({ sessionId: 'user-ui', priority: 'interactive' });

    expect(events).toEqual([]);
  });
});

describe('admit：开关关闭 ⇒ 抢占零行为变更（默认关）', () => {
  it('不登记 / 不抢占 / 不回调', () => {
    delete process.env[ENV];
    const calls: string[] = [];
    const gov = new ResourceGovernor({
      maxInflight: 1,
      onPreempt: (victim) => calls.push(victim),
    });

    gov.admit({ sessionId: 'bg-job', priority: 'background' });
    const d = gov.admit({ sessionId: 'user-ui', priority: 'interactive' });

    expect(d.inFlightCount).toBe(0);
    expect(d.overLimit).toBe(false);
    expect(d.preempted).toEqual([]);
    expect(calls).toEqual([]);
    expect(gov.snapshot()).toEqual([]);
  });
});
