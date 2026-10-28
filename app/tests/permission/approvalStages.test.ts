/**
 * 审批四段判定内核 —— 规格 `.trae/specs/p5-runtime-hardening-specs.md` §1（P5-5，2026-10-28）
 *
 * 锁住三条硬规则（对应规格 A2/A3/A4）：
 * ① **不得跳段**（`requested → presented → decided → recorded` 逐段）；
 * ② **决定必须显式**（`decided` 必带 `decision`；`deny` 是终态，不得进入 `recorded`）；
 * ③ **授权维度随决定**（`allow_session` 必须带 `fingerprint`）。
 *
 * ⚠️ 本内核**尚无运行时消费者**（四段横跨 chat/SSE/客户端，接线单独立项）；本文件保证
 * "接线前的顺序语义已被钉死"，接线时不再改判据。
 */
import { describe, expect, it } from 'bun:test';

import {
  APPROVAL_STAGES,
  advanceApproval,
  isApprovalExecutable,
  startApprovalChain,
  type ApprovalChainState,
} from '../../src/permission/approvalStages';

/** 推进到某段（测试辅助；失败即抛，避免用例里堆 result 判定） */
function advanceTo(
  state: ApprovalChainState,
  stages: Array<'presented' | 'decided' | 'recorded'>,
  options: {
    decision?: 'allow_once' | 'allow_session' | 'deny';
    fingerprint?: string;
  } = {}
): ApprovalChainState {
  let cur = state;
  for (const stage of stages) {
    const result = advanceApproval(cur, stage, options);
    if (!result.ok) throw new Error(`unexpected reject: ${result.reason}`);
    cur = result.state;
  }
  return cur;
}

describe('审批四段 · 顺序与前置条件', () => {
  it('四段顺序固定，起点是 requested', () => {
    expect(APPROVAL_STAGES).toEqual([
      'requested',
      'presented',
      'decided',
      'recorded',
    ]);
    expect(startApprovalChain()).toEqual({ stage: 'requested' });
  });

  it('允许一次会话的主要顺序：requested → presented → decided → recorded', () => {
    const decided = advanceTo(startApprovalChain(), ['presented', 'decided'], {
      decision: 'allow_once',
      fingerprint: 'fp-1',
    });
    expect(isApprovalExecutable(decided)).toBe(true);

    const recorded = advanceApproval(decided, 'recorded');
    expect(recorded.ok).toBe(true);
    if (recorded.ok) expect(recorded.state.stage).toBe('recorded');
  });

  it('门禁自证（负向夹具）：跳段 ⇒ 必拒（requested 直接 decided / 直接 recorded）', () => {
    for (const next of ['decided', 'recorded'] as const) {
      const result = advanceApproval(startApprovalChain(), next, {
        decision: 'allow_once',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('逐段前进');
    }
  });

  it('不得回退 / 重放同一段', () => {
    const presented = advanceTo(startApprovalChain(), ['presented']);
    const back = advanceApproval(presented, 'requested');
    expect(back.ok).toBe(false);
    const again = advanceApproval(presented, 'presented');
    expect(again.ok).toBe(false);
  });

  it('`decided` 不带 decision ⇒ 必拒（不得"默认允许"）', () => {
    const presented = advanceTo(startApprovalChain(), ['presented']);
    const result = advanceApproval(presented, 'decided');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('必须带 decision');
  });

  it('`allow_session` 不带 fingerprint ⇒ 必拒（授权维度不得放大）', () => {
    const presented = advanceTo(startApprovalChain(), ['presented']);
    const result = advanceApproval(presented, 'decided', {
      decision: 'allow_session',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('fingerprint');

    const withFp = advanceApproval(presented, 'decided', {
      decision: 'allow_session',
      fingerprint: 'fp-session',
    });
    expect(withFp.ok).toBe(true);
  });

  it('`deny` 是终态：不可再 recorded、也不可执行', () => {
    const denied = advanceTo(startApprovalChain(), ['presented', 'decided'], {
      decision: 'deny',
    });
    expect(isApprovalExecutable(denied)).toBe(false);

    const result = advanceApproval(denied, 'recorded');
    expect(result.ok).toBe(false);
  });

  it('未决定（presented）不得执行；recorded 之后不得再推进', () => {
    const presented = advanceTo(startApprovalChain(), ['presented']);
    expect(isApprovalExecutable(presented)).toBe(false);

    const recorded = advanceApproval(
      advanceTo(startApprovalChain(), ['presented', 'decided'], {
        decision: 'allow_once',
      }),
      'recorded'
    );
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const after = advanceApproval(recorded.state, 'recorded');
    expect(after.ok).toBe(false);
  });

  it('未知段 ⇒ 必拒（fail-closed，不得静默通过）', () => {
    const result = advanceApproval(
      startApprovalChain(),
      'approved' as unknown as 'presented'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('未知审批段');
  });
});
