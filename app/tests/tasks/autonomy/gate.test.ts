/**
 * P33-a · 自主触发准入判定（2026-11-02）
 *
 * 覆盖：
 * ① `enabled=false` ⇒ 直接放行（零行为变更、无 Mandate）；
 * ② `observe` ⇒ ignore + wouldAccept（零副作用）；
 * ③ `auto` + 规则命中 ⇒ accept + Mandate（strength/via/rules/policyVersion/scope）；
 * ④ `off` / 来源关闭 / 规则未命中 / 风险 high / 过滤器 ⇒ 拒绝且原因可枚举。
 */
import { describe, it, expect } from 'bun:test';

import type { AutonomyPolicyConfig } from '@openliri/infra/permission';
import {
  evaluateAutonomyTrigger,
  type AutonomyTriggerFacts,
} from '../../../src/tasks/autonomy/gate';

const POLICY_ID = 'ps1-test';

const TRIGGER: AutonomyTriggerFacts = {
  sourceId: 'cron',
  threadKey: 'cron:job-1',
  triggerId: 'tg1-1',
};

function policy(
  over: Partial<AutonomyPolicyConfig> = {}
): AutonomyPolicyConfig {
  return {
    enabled: true,
    acceptMode: 'auto',
    sources: { cron: true },
    admission: {},
    rules: [{ id: 'r1', text: '定时巡检', enabled: true }],
    ...over,
  };
}

function evaluate(
  over: Partial<AutonomyPolicyConfig> = {},
  trigger: AutonomyTriggerFacts = TRIGGER
) {
  return evaluateAutonomyTrigger({
    policy: policy(over),
    policyId: POLICY_ID,
    trigger,
  });
}

describe('evaluateAutonomyTrigger', () => {
  it('enabled=false ⇒ accept（不判定、不产生 Mandate）', () => {
    const decision = evaluate({ enabled: false });
    expect(decision).toMatchObject({
      action: 'accept',
      wouldAccept: true,
      policyId: POLICY_ID,
      matchedRuleIds: [],
    });
    expect(decision.mandate).toBeUndefined();
  });

  it('observe + 规则命中 ⇒ ignore + wouldAccept（零副作用）', () => {
    const decision = evaluate({ acceptMode: 'observe' });
    expect(decision).toMatchObject({
      action: 'ignore',
      wouldAccept: true,
      reason: 'mode_observe',
      strength: 'inferred',
      via: 'bot',
      matchedRuleIds: ['r1'],
    });
    expect(decision.mandate).toBeUndefined();
  });

  it('auto + 规则命中 ⇒ accept + Mandate', () => {
    const decision = evaluate();
    expect(decision).toMatchObject({
      action: 'accept',
      wouldAccept: true,
      strength: 'inferred',
      via: 'bot',
      matchedRuleIds: ['r1'],
    });
    expect(decision.mandate).toEqual({
      strength: 'inferred',
      basis: {
        via: 'bot',
        rules: ['r1'],
        policyVersion: POLICY_ID,
      },
      scope: { source: 'cron', thread: 'cron:job-1' },
    });
  });

  it('off ⇒ 拒绝（admission_ignored）', () => {
    const decision = evaluate({ acceptMode: 'off' });
    expect(decision).toMatchObject({
      action: 'ignore',
      wouldAccept: false,
      reason: 'admission_ignored',
    });
  });

  it('来源关闭 ⇒ 拒绝（source_not_listening）', () => {
    const decision = evaluate({ sources: { cron: false } });
    expect(decision).toMatchObject({
      action: 'ignore',
      wouldAccept: false,
      reason: 'source_not_listening',
    });
  });

  it('规则未命中 / 全禁用 ⇒ 拒绝（rules_unmatched）', () => {
    expect(evaluate({ rules: [] })).toMatchObject({
      action: 'ignore',
      wouldAccept: false,
      reason: 'rules_unmatched',
    });
    expect(
      evaluate({ rules: [{ id: 'r1', text: '', enabled: false }] })
    ).toMatchObject({
      action: 'ignore',
      wouldAccept: false,
      reason: 'rules_unmatched',
    });
  });

  it('规则只适用于其他来源 ⇒ 不命中', () => {
    const decision = evaluate({
      rules: [{ id: 'r1', text: '', enabled: true, sources: ['alwayson'] }],
    });
    expect(decision).toMatchObject({
      action: 'ignore',
      reason: 'rules_unmatched',
      matchedRuleIds: [],
    });
  });

  it('风险 high ⇒ 拒绝（risk_high）', () => {
    const decision = evaluate({}, { ...TRIGGER, riskLevel: 'high' });
    expect(decision).toMatchObject({
      action: 'ignore',
      wouldAccept: false,
      reason: 'risk_high',
    });
  });

  it('线程前缀过滤不匹配 ⇒ 拒绝（filtered_out）', () => {
    const decision = evaluate({
      filters: { threadPrefixes: ['fs:'] },
    });
    expect(decision).toMatchObject({
      action: 'ignore',
      wouldAccept: false,
      reason: 'filtered_out',
    });
  });

  it('线程前缀匹配 ⇒ 继续判定', () => {
    const decision = evaluate({
      filters: { threadPrefixes: ['cron:'] },
    });
    expect(decision.action).toBe('accept');
  });
});
