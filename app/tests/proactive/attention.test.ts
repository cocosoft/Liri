/**
 * P37 · 结构化 Attention（三档 + 每工作项打扰预算）
 *
 * 覆盖方案 §5 P37 的验收口径：
 * ① 三档判定：有行动价值 ⇒ speak；过程性进展 ⇒ silent；DND/限流 ⇒ queue；
 * ② **禁止从自由文本判定**：只有 `attention` 事实参与判定，未提供时行为与改造前一致；
 * ③ 每工作项打扰 ≤2（缺省），计数即队列台账（`recent[].ticketId`），CRITICAL 豁免；
 * ④ Inbox 结构化字段可往返（`toInboxMetadata` / `readInboxAttention`）。
 */
import { describe, it, expect } from 'bun:test';

import {
  MAX_TICKET_INTERRUPTIONS,
  isActionableAttention,
  isTicketBudgetExhausted,
  readInboxAttention,
  resolveAttentionTier,
  toInboxMetadata,
  type AttentionFacts,
} from '../../src/proactive/attention';
import { evaluateProactiveNotification } from '../../src/proactive/ProactiveNotificationGate';
import type {
  ProactiveGateContext,
  ProactiveMessagePayload,
} from '../../src/proactive/types';

const NOW = Date.parse('2026-10-19T12:00:00Z'); // 20:00 Asia/Shanghai

function facts(over: Partial<AttentionFacts> = {}): AttentionFacts {
  return {
    humanWaiting: false,
    needsDecision: false,
    usableOutput: false,
    ...over,
  };
}

function payload(
  over: Partial<ProactiveMessagePayload> = {}
): ProactiveMessagePayload {
  return {
    id: 'p-1',
    kind: 'task_result',
    priority: 'normal',
    dedupeKey: 'task:p-1',
    title: '任务完成',
    body: 'ok',
    createdAt: NOW,
    expiresAt: NOW + 60 * 60_000,
    ...over,
  };
}

function ctx(over: Partial<ProactiveGateContext> = {}): ProactiveGateContext {
  return {
    now: NOW,
    timezone: 'Asia/Shanghai',
    // 本文件只验证「预算 / 三档」；同类冷却显式关掉，避免 recent 触发 ⑥ 干扰断言
    prefs: { enabled: true, maxPerHour: 100, cooldownMs: { task_result: 0 } },
    recent: [],
    ...over,
  };
}

describe('三档判定（纯函数）', () => {
  it('有任一行动价值 ⇒ 可打断', () => {
    expect(isActionableAttention(facts())).toBe(false);
    expect(isActionableAttention(facts({ humanWaiting: true }))).toBe(true);
    expect(isActionableAttention(facts({ needsDecision: true }))).toBe(true);
    expect(isActionableAttention(facts({ usableOutput: true }))).toBe(true);
  });

  it('门禁动作 × 事实 ⇒ 档位', () => {
    expect(
      resolveAttentionTier(facts({ needsDecision: true }), 'deliver')
    ).toBe('speak');
    expect(resolveAttentionTier(facts(), 'deliver')).toBe('silent');
    expect(resolveAttentionTier(facts({ needsDecision: true }), 'queue')).toBe(
      'queue'
    );
    expect(resolveAttentionTier(facts({ needsDecision: true }), 'drop')).toBe(
      'silent'
    );
    // 未提供事实 ⇒ 兼容既有生产者（deliver 即 speak）
    expect(resolveAttentionTier(undefined, 'deliver')).toBe('speak');
  });

  it('打扰预算：缺省 2 次；maxPerTicket<=0 ⇒ 不设限', () => {
    expect(MAX_TICKET_INTERRUPTIONS).toBe(2);
    expect(isTicketBudgetExhausted(1)).toBe(false);
    expect(isTicketBudgetExhausted(2)).toBe(true);
    expect(isTicketBudgetExhausted(9, 0)).toBe(false);
    expect(isTicketBudgetExhausted(2, 3)).toBe(false);
  });
});

describe('门禁：三档只在提供事实时出现（旧消费者行为不变）', () => {
  it('过程性进展（三事实全 false）⇒ deliver 但 tier=silent', () => {
    const decision = evaluateProactiveNotification(
      payload({ attention: facts(), priority: 'low' }),
      ctx()
    );
    expect(decision).toEqual({
      action: 'deliver',
      reason: 'ok',
      tier: 'silent',
    });
  });

  it('需人决策 ⇒ tier=speak', () => {
    const decision = evaluateProactiveNotification(
      payload({ attention: facts({ needsDecision: true }) }),
      ctx()
    );
    expect(decision.action).toBe('deliver');
    expect(decision.tier).toBe('speak');
  });

  it('DND 内 ⇒ 强制 queue（不得升级为 speak）', () => {
    const decision = evaluateProactiveNotification(
      payload({ attention: facts({ needsDecision: true }) }),
      ctx({
        prefs: {
          enabled: true,
          maxPerHour: 100,
          cooldownMs: { task_result: 0 },
          dnd: { start: '19:00', end: '23:00' },
        },
      })
    );
    expect(decision.action).toBe('queue');
    expect(decision.tier).toBe('queue');
  });

  it('未提供 attention ⇒ 返回形状与改造前一致（无 tier 键）', () => {
    const decision = evaluateProactiveNotification(payload(), ctx());
    expect(decision).toEqual({ action: 'deliver', reason: 'ok' });
    expect('tier' in decision).toBe(false);
  });
});

describe('门禁：每工作项打扰预算（计数 = 队列台账）', () => {
  const recentSameTicket = [
    {
      dedupeKey: 'a',
      kind: 'task_result' as const,
      deliveredAt: NOW - 1000,
      ticketId: 'plan-1',
    },
    {
      dedupeKey: 'b',
      kind: 'task_result' as const,
      deliveredAt: NOW - 500,
      ticketId: 'plan-1',
    },
  ];

  it('同一工作项已打扰 2 次 ⇒ drop（ticket_budget）', () => {
    const decision = evaluateProactiveNotification(
      payload({ ticketId: 'plan-1', dedupeKey: 'c' }),
      ctx({ recent: recentSameTicket })
    );
    expect(decision).toEqual({ action: 'drop', reason: 'ticket_budget' });
  });

  it('超出预算时若带事实 ⇒ tier=silent（只写日志）', () => {
    const decision = evaluateProactiveNotification(
      payload({
        ticketId: 'plan-1',
        dedupeKey: 'c',
        attention: facts({ needsDecision: true }),
      }),
      ctx({ recent: recentSameTicket })
    );
    expect(decision.action).toBe('drop');
    expect(decision.tier).toBe('silent');
  });

  it('CRITICAL 豁免预算', () => {
    const decision = evaluateProactiveNotification(
      payload({
        ticketId: 'plan-1',
        dedupeKey: 'c',
        priority: 'critical',
      }),
      ctx({ recent: recentSameTicket })
    );
    expect(decision).toEqual({
      action: 'deliver',
      reason: 'critical_bypass',
    });
  });

  it('maxPerTicket 可覆盖（3 ⇒ 第 2 次不拦截）', () => {
    const decision = evaluateProactiveNotification(
      payload({ ticketId: 'plan-1', dedupeKey: 'c' }),
      ctx({
        recent: recentSameTicket,
        prefs: {
          enabled: true,
          maxPerHour: 100,
          maxPerTicket: 3,
          cooldownMs: { task_result: 0 },
        },
      })
    );
    expect(decision.action).toBe('deliver');
  });

  it('不同工作项互不影响；无 ticketId ⇒ 不参与预算', () => {
    expect(
      evaluateProactiveNotification(
        payload({ ticketId: 'plan-2', dedupeKey: 'c' }),
        ctx({ recent: recentSameTicket })
      ).action
    ).toBe('deliver');
    expect(
      evaluateProactiveNotification(
        payload({ dedupeKey: 'c' }),
        ctx({ recent: recentSameTicket })
      ).action
    ).toBe('deliver');
  });
});

describe('Inbox 结构化字段（禁止从文本判定）', () => {
  it('toInboxMetadata / readInboxAttention 往返', () => {
    const meta = toInboxMetadata({
      kind: 'question',
      question: '要继续吗？',
      ticketId: 't-1',
      triggerId: 'tg1-abc',
      options: ['yes', 'no'],
      createdAt: NOW,
    });
    expect(readInboxAttention(meta)).toEqual({
      kind: 'question',
      question: '要继续吗？',
      ticketId: 't-1',
      triggerId: 'tg1-abc',
    });
  });

  it('缺失 / 非法 kind ⇒ 不猜（undefined）', () => {
    expect(readInboxAttention(undefined)).toBeUndefined();
    expect(readInboxAttention({})).toBeUndefined();
    expect(
      readInboxAttention({ attentionKind: 'nope', attentionQuestion: 'x' })
    ).toBeUndefined();
  });
});
