/**
 * Budget Lease 判定内核 —— 规格 `.trae/specs/p5-runtime-hardening-specs.md` §2（P5-6，2026-10-28）
 *
 * 锁住：① 不超额授予；② 同一 execution 一对一；③ 到期回收 / 用尽只拒**下一回合**；
 * ④ 非法输入 fail-closed（不静默降额、不默认放行）。
 */
import { describe, expect, it } from 'bun:test';

import {
  findActiveLeaseOfExecution,
  grantLease,
  isLeaseExhausted,
  resolveLeaseCap,
  settleLease,
  shouldRejectNextTurn,
  summarizeLeases,
  type BudgetLease,
} from '../../src/execution/budgetLease';

const NOW = 1_000_000;
const TTL = 5 * 60 * 1000;

function leaseOf(overrides: Partial<BudgetLease> = {}): BudgetLease {
  return {
    leaseId: 'lease-1',
    executionId: 'exec-1',
    sessionId: 'sess-1',
    amount: 1000,
    used: 0,
    expiresAt: NOW + TTL,
    ...overrides,
  };
}

function grant(overrides: Partial<Parameters<typeof grantLease>[0]> = {}) {
  return grantLease({
    leases: [],
    leaseId: 'lease-1',
    executionId: 'exec-1',
    sessionId: 'sess-1',
    amount: 1000,
    cap: 5000,
    ttlMs: TTL,
    now: NOW,
    ...overrides,
  });
}

describe('Budget Lease · 授予与占用', () => {
  it('汇总只计**活跃**租约；到期即视为回收（不计占用）', () => {
    const active = leaseOf({ leaseId: 'a', amount: 1000 });
    const expired = leaseOf({
      leaseId: 'b',
      executionId: 'exec-2',
      amount: 4000,
      expiresAt: NOW, // 到期边界：`<= now` 即失效
    });
    expect(summarizeLeases([active, expired], NOW)).toEqual({
      committed: 1000,
      activeLeases: 1,
      expiredLeases: 1,
    });
  });

  it('不超额授予：`已占用 + 本次 > 上限` ⇒ 拒绝（不静默降额）', () => {
    const result = grant({
      leases: [leaseOf({ leaseId: 'a', amount: 4500 })],
      executionId: 'exec-2',
      amount: 1000,
      cap: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('超额授予');
  });

  it('恰好用满上限 ⇒ 允许（边界可授予）', () => {
    const result = grant({
      leases: [leaseOf({ leaseId: 'a', amount: 4000 })],
      executionId: 'exec-2',
      amount: 1000,
      cap: 5000,
    });
    expect(result.ok).toBe(true);
  });

  it('同一 execution 一对一：已持有未结算租约 ⇒ 拒绝', () => {
    const result = grant({
      leases: [leaseOf({ leaseId: 'a', executionId: 'exec-1', amount: 500 })],
      executionId: 'exec-1',
      amount: 500,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('一对一');
  });

  it('前一个租约**到期**后，同一 execution 可再次授予', () => {
    const expired = leaseOf({
      leaseId: 'a',
      executionId: 'exec-1',
      expiresAt: NOW - 1,
    });
    expect(
      findActiveLeaseOfExecution([expired], 'exec-1', NOW)
    ).toBeUndefined();
    expect(grant({ leases: [expired], executionId: 'exec-1' }).ok).toBe(true);
  });

  it('非法输入 fail-closed：额度/上限/时长非正 ⇒ 拒绝', () => {
    for (const overrides of [
      { amount: 0 },
      { amount: -1 },
      { cap: 0 },
      { ttlMs: 0 },
    ]) {
      const result = grant(overrides);
      expect(result.ok).toBe(false);
    }
  });

  it('门禁自证（负向夹具）：手工构造"绕过上限"的租约 ⇒ 汇总立刻暴露超额', () => {
    // 模拟缺陷：不经过 grantLease 直接塞两个租约（旧实现常见形态：只累加不校验）
    const bypassed = [
      leaseOf({ leaseId: 'a', amount: 4000 }),
      leaseOf({ leaseId: 'b', executionId: 'exec-2', amount: 4000 }),
    ];
    const { committed } = summarizeLeases(bypassed, NOW);
    expect(committed).toBeGreaterThan(5000);
  });
});

describe('Budget Lease · 结算与下一回合', () => {
  it('结算立即回收剩余额度（expiresAt = now ⇒ 不再计入占用）', () => {
    const lease = leaseOf({ amount: 1000 });
    const settled = settleLease(lease, 600, NOW);
    expect(settled.used).toBe(600);
    expect(settled.expiresAt).toBe(NOW);
    expect(summarizeLeases([settled], NOW).committed).toBe(0);
  });

  it('结算的 used 被夹在 [0, amount]（不得超出授予额度）', () => {
    expect(settleLease(leaseOf({ amount: 100 }), 999, NOW).used).toBe(100);
    expect(settleLease(leaseOf({ amount: 100 }), -5, NOW).used).toBe(0);
  });

  it('租约用尽 ⇒ 只拒**该会话**的下一回合（其他会话不受影响）', () => {
    const exhausted = leaseOf({ used: 1000 });
    expect(isLeaseExhausted(exhausted)).toBe(true);
    expect(shouldRejectNextTurn([exhausted], 'sess-1', NOW)).toBe(true);
    expect(shouldRejectNextTurn([exhausted], 'sess-2', NOW)).toBe(false);
  });

  it('未用尽 / 已到期 ⇒ 不拒下一回合（到期即回收，不得永久阻断）', () => {
    expect(shouldRejectNextTurn([leaseOf({ used: 999 })], 'sess-1', NOW)).toBe(
      false
    );
    const expired = leaseOf({ used: 1000, expiresAt: NOW - 1 });
    expect(shouldRejectNextTurn([expired], 'sess-1', NOW)).toBe(false);
  });
});

describe('Budget Lease · cap 来源（规格 §2.4 第 3 问）', () => {
  it('配置显式值优先', () => {
    expect(resolveLeaseCap(120_000, 200_000)).toBe(120_000);
  });

  it('配置缺省（0/负数/非有限）⇒ 取**会话级 tokenBudget 汇总**', () => {
    expect(resolveLeaseCap(0, 200_000)).toBe(200_000);
    expect(resolveLeaseCap(-1, 200_000)).toBe(200_000);
    expect(resolveLeaseCap(Number.NaN, 200_000)).toBe(200_000);
    // 非有限数不算"显式配置"（Number.isFinite 为假）⇒ 落到会话汇总
    expect(resolveLeaseCap(Number.POSITIVE_INFINITY, 200_000)).toBe(200_000);
  });

  it('两者都不可用 ⇒ 0（交给 grantLease fail-closed 拒绝授予）', () => {
    expect(resolveLeaseCap(0, 0)).toBe(0);
    expect(resolveLeaseCap(0, Number.NaN)).toBe(0);
    const result = grant({ cap: resolveLeaseCap(0, 0) });
    expect(result.ok).toBe(false);
  });
});
