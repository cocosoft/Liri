/**
 * streamDisconnectGrace 单测（2026-11-18，Spec `.trae/specs/stream-attach-grace.md` §9）
 *
 * 这段判定决定"本轮还活不活"，必须锁死两个方向：
 * ① `graceMs=0`（默认）⇒ 与改动前逐字等价（断开即中止）；
 * ② 宽限到期 ⇒ **只有无人接管**才中止（有人看着不得误杀）。
 */
import { describe, expect, it } from 'bun:test';

import {
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
