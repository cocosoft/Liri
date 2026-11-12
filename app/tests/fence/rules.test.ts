/**
 * 围栏 M2：S1（静默放行空转）/ S2（deny 后重试）规则单测。
 *
 * 每条规则都同时覆盖**正例**与**误报防护**（这是 M2 的验收重点：
 * 观测规则最容易变成告警噪音）。
 */

import { describe, expect, it } from 'bun:test';

import {
  createFenceRuleState,
  evaluateAuditEvent,
  normalizeCommand,
  parseAuditEvent,
  type FenceAuditEvent,
  type FenceRuleConfig,
} from '../../src/entrypoints/fence/rules.js';

const CONFIG: FenceRuleConfig = {
  silentAllowRunLength: 3,
  denyRetryWindowMs: 60_000,
};

function event(overrides: Partial<FenceAuditEvent> = {}): FenceAuditEvent {
  const command = overrides.command ?? 'ls';
  return {
    timestamp: '2026-11-12T10:00:00.000Z',
    command,
    normalizedCommand: normalizeCommand(command),
    behavior: 'allow',
    riskLevel: 'medium',
    matchedRulesCount: 1,
    ...overrides,
  };
}

/** 一次「无规则匹配 ⇒ 默认放行」事件（S1 的唯一计数条件） */
function silentAllow(timestamp: string, command = 'ls'): FenceAuditEvent {
  return event({
    timestamp,
    command,
    behavior: 'allow',
    riskLevel: 'high',
    matchedRulesCount: 0,
  });
}

describe('M2 / parseAuditEvent', () => {
  it('优先 originalCommand；缺失则回退 command', () => {
    const withOriginal = parseAuditEvent(
      JSON.stringify({
        timestamp: '2026-11-12T10:00:00.000Z',
        command: 'ls -la',
        originalCommand: 'ls   -la ',
        behavior: 'allow',
        riskLevel: 'medium',
        matchedRules: ['r1'],
      })
    );
    expect(withOriginal?.command).toBe('ls   -la ');
    expect(withOriginal?.normalizedCommand).toBe('ls -la');
    expect(withOriginal?.matchedRulesCount).toBe(1);
  });

  it('坏 JSON / 缺 timestamp / 缺命令 ⇒ undefined（不猜）', () => {
    expect(parseAuditEvent('not-json')).toBeUndefined();
    expect(parseAuditEvent(JSON.stringify({ command: 'ls' }))).toBeUndefined();
    expect(
      parseAuditEvent(JSON.stringify({ timestamp: '2026-11-12T10:00:00.000Z' }))
    ).toBeUndefined();
  });
});

describe('M2 / S1 静默放行空转', () => {
  it('连续 3 次「无规则匹配 ⇒ 默认放行」⇒ 第 3 次告警，随后重新计数', () => {
    const state = createFenceRuleState();
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:00.000Z'), state, CONFIG)
    ).toEqual([]);
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:01.000Z'), state, CONFIG)
    ).toEqual([]);
    const third = evaluateAuditEvent(
      silentAllow('2026-11-12T10:00:02.000Z'),
      state,
      CONFIG
    );
    expect(third.map((f) => f.kind)).toEqual(['silent-allow-streak']);

    // 已告警 ⇒ 计数清零，不会逐条刷屏
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:03.000Z'), state, CONFIG)
    ).toEqual([]);
  });

  it('误报防护：medium 风险 / 有命中规则 / ask / deny 都不计数，并清空连续段', () => {
    const state = createFenceRuleState();
    evaluateAuditEvent(silentAllow('2026-11-12T10:00:00.000Z'), state, CONFIG);
    evaluateAuditEvent(silentAllow('2026-11-12T10:00:01.000Z'), state, CONFIG);

    // 有命中规则的 allow（riskLevel 仍为 high）⇒ 不属于"空转"
    evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:00:02.000Z',
        riskLevel: 'high',
        matchedRulesCount: 1,
      }),
      state,
      CONFIG
    );
    // 连续段被清空 ⇒ 再两次也不告警
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:03.000Z'), state, CONFIG)
    ).toEqual([]);
    expect(
      evaluateAuditEvent(silentAllow('2026-11-12T10:00:04.000Z'), state, CONFIG)
    ).toEqual([]);
  });
});

describe('M2 / S2 deny 后重试', () => {
  it('同命令（空白归一后）在窗口内再次出现 ⇒ 告警', () => {
    const state = createFenceRuleState();
    expect(
      evaluateAuditEvent(
        event({
          timestamp: '2026-11-12T10:00:00.000Z',
          command: 'rm -rf /tmp/x',
          behavior: 'deny',
          riskLevel: 'high',
        }),
        state,
        CONFIG
      )
    ).toEqual([]);

    const retry = evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:00:10.000Z',
        command: 'rm   -rf   /tmp/x',
        behavior: 'deny',
        riskLevel: 'high',
      }),
      state,
      CONFIG
    );
    expect(retry.map((f) => f.kind)).toEqual(['deny-retry']);
  });

  it('误报防护：窗口外 / 不同命令 / 无 deny 都不告警', () => {
    const state = createFenceRuleState();
    evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:00:00.000Z',
        command: 'rm -rf /tmp/x',
        behavior: 'deny',
      }),
      state,
      CONFIG
    );

    const outsideWindow = evaluateAuditEvent(
      event({
        timestamp: '2026-11-12T10:05:00.000Z',
        command: 'rm -rf /tmp/x',
      }),
      state,
      CONFIG
    );
    expect(outsideWindow).toEqual([]);

    const otherCommand = evaluateAuditEvent(
      event({ timestamp: '2026-11-12T10:00:10.000Z', command: 'echo hi' }),
      state,
      CONFIG
    );
    expect(otherCommand).toEqual([]);
  });
});
