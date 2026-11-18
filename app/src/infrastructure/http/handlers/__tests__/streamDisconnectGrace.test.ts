/**
 * streamDisconnectGrace 单测（2026-11-18，Spec `.trae/specs/stream-attach-grace.md` §9）
 *
 * 这段判定决定"本轮还活不活"，必须锁死两个方向：
 * ① `graceMs=0`（默认）⇒ 与改动前逐字等价（断开即中止）；
 * ② 宽限到期 ⇒ **只有无人接管**才中止（有人看着不得误杀）。
 */
import { describe, expect, it } from 'bun:test';

import {
  createGracefulDetach,
  resolveDisconnectAction,
  shouldAbortWhenGraceExpires,
} from '../streamDisconnectGrace';

describe('resolveDisconnectAction', () => {
  it('graceMs=0（默认）⇒ abort（保持既有"断开即中止"）', () => {
    expect(resolveDisconnectAction(0, false)).toEqual({ kind: 'abort' });
  });

  it('graceMs<0 视为关闭 ⇒ abort', () => {
    expect(resolveDisconnectAction(-1, false)).toEqual({ kind: 'abort' });
  });

  it('graceMs>0 ⇒ detach，并带上宽限期', () => {
    expect(resolveDisconnectAction(60_000, false)).toEqual({
      kind: 'detach',
      graceMs: 60_000,
    });
  });

  it('已 detached ⇒ continue（重复触发的 close/loop 不得重复 arm）', () => {
    expect(resolveDisconnectAction(60_000, true)).toEqual({ kind: 'continue' });
    expect(resolveDisconnectAction(0, true)).toEqual({ kind: 'continue' });
  });
});

describe('shouldAbortWhenGraceExpires', () => {
  it('无人接管 ⇒ 中止（不留孤儿运行）', () => {
    expect(shouldAbortWhenGraceExpires(false)).toBe(true);
  });

  it('已有订阅者 ⇒ 不中止（有人在看，按正常流式处理）', () => {
    expect(shouldAbortWhenGraceExpires(true)).toBe(false);
  });
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe('createGracefulDetach（主链路与续跑流共用的控制器）', () => {
  it('grace=0 ⇒ tryDetach=false，不进入后台、不 arm 定时器', async () => {
    let detached = 0;
    let aborted = 0;
    const ctl = createGracefulDetach({
      graceMs: 0,
      sessionId: 's0',
      onDetach: () => detached++,
      onAbort: () => aborted++,
      hasSubscribers: () => false,
    });

    expect(ctl.tryDetach('close')).toBe(false);
    expect(ctl.isDetached()).toBe(false);
    await sleep(20);
    expect(detached).toBe(0);
    expect(aborted).toBe(0);
  });

  it('grace>0 ⇒ 进入后台一次（重复触发幂等），到期无人接入 ⇒ onAbort', async () => {
    let detached = 0;
    let aborted = 0;
    const ctl = createGracefulDetach({
      graceMs: 20,
      sessionId: 's1',
      onDetach: () => detached++,
      onAbort: () => aborted++,
      hasSubscribers: () => false,
    });

    expect(ctl.tryDetach('close')).toBe(true);
    expect(ctl.isDetached()).toBe(true);
    // 循环内重复发现 destroyed ⇒ 只算一次 detach、不重复 arm
    expect(ctl.tryDetach('loop')).toBe(true);
    expect(detached).toBe(1);

    await sleep(45);
    expect(aborted).toBe(1);
  });

  it('到期前有 attach 订阅者 ⇒ 不中止本轮', async () => {
    let aborted = 0;
    const ctl = createGracefulDetach({
      graceMs: 20,
      sessionId: 's2',
      onAbort: () => aborted++,
      hasSubscribers: () => true,
    });

    ctl.tryDetach('close');
    await sleep(45);
    expect(aborted).toBe(0);
    expect(ctl.isDetached()).toBe(true);
  });

  it('finish() ⇒ 清定时器（不再中止），且之后的 tryDetach 视为无需处理', async () => {
    let aborted = 0;
    const ctl = createGracefulDetach({
      graceMs: 20,
      sessionId: 's3',
      onAbort: () => aborted++,
      hasSubscribers: () => false,
    });

    ctl.tryDetach('close');
    ctl.finish();
    await sleep(45);
    expect(aborted).toBe(0);
    // 已收尾后的 close 不得 arm 宽限
    expect(ctl.tryDetach('close')).toBe(true);
  });
});
