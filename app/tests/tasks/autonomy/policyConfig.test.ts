/**
 * P33-a · `autonomy.policy` 配置面（2026-11-02）
 *
 * 覆盖：
 * ① 缺省 ⇒ `enabled=false`、`acceptMode=observe`（零行为变更）；
 * ② 合法配置 ⇒ 原样解析，`policyId` 稳定且随规则变化；
 * ③ 非法配置 ⇒ fail-closed 为 `enabled=false, acceptMode='off'` 并给出 errors；
 * ④ 读取来源如实透出（托管 `policySettings` / 用户 `userSettings`）。
 */
import { describe, it, expect } from 'bun:test';

import {
  DEFAULT_AUTONOMY_POLICY,
  computeAutonomyPolicyId,
  loadAutonomyPolicy,
  parseAutonomyPolicy,
  resolveTicketBudgetLimits,
} from '../../../src/tasks/autonomy/policyConfig';

const VALID = {
  enabled: true,
  acceptMode: 'auto',
  sources: { cron: true, alwayson: false },
  admission: { cron: { listedUnaddressed: 'inferred' } },
  rules: [
    {
      id: 'cron.tick',
      text: '定时巡检',
      enabled: true,
      sources: ['cron'],
    },
  ],
};

describe('parseAutonomyPolicy', () => {
  it('缺省 ⇒ enabled=false / observe / 来源默认', () => {
    const { config, errors } = parseAutonomyPolicy(undefined);
    expect(errors).toEqual([]);
    expect(config).toEqual(DEFAULT_AUTONOMY_POLICY);
    expect(config.enabled).toBe(false);
    expect(config.acceptMode).toBe('observe');
    expect(config.sources.cron).toBe(true);
    expect(config.sources.dream).toBe(false);
  });

  it('合法配置 ⇒ 原样解析（规则缺省 text 为字符串）', () => {
    const { config, errors } = parseAutonomyPolicy(VALID);
    expect(errors).toEqual([]);
    expect(config.enabled).toBe(true);
    expect(config.acceptMode).toBe('auto');
    expect(config.sources).toEqual({
      cron: true,
      alwayson: false,
      dream: false,
      fs: false,
      // D1（2026-11-14）：外部事件来源默认关
      external: false,
    });
    expect(config.admission.cron?.listedUnaddressed).toBe('inferred');
    expect(config.rules).toEqual(VALID.rules);
  });

  it('非法 acceptMode ⇒ fail-closed 为 enabled=false / off', () => {
    const { config, errors } = parseAutonomyPolicy({
      ...VALID,
      acceptMode: 'sometimes',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(config.enabled).toBe(false);
    expect(config.acceptMode).toBe('off');
  });

  it('非法规则项 / 非布尔来源 ⇒ fail-closed', () => {
    const badRule = parseAutonomyPolicy({
      ...VALID,
      rules: [{ id: 'r', enabled: 'yes' }],
    });
    expect(badRule.config.enabled).toBe(false);
    expect(badRule.config.acceptMode).toBe('off');

    const badSource = parseAutonomyPolicy({
      ...VALID,
      sources: { cron: 'yes' },
    });
    expect(badSource.config.enabled).toBe(false);
    expect(badSource.errors.length).toBeGreaterThan(0);
  });

  it('policyId 稳定；规则变化 ⇒ 版本变化', () => {
    const a = parseAutonomyPolicy(VALID).config;
    const b = parseAutonomyPolicy(VALID).config;
    expect(computeAutonomyPolicyId(a)).toBe(computeAutonomyPolicyId(b));

    const changed = parseAutonomyPolicy({
      ...VALID,
      rules: [{ id: 'cron.tick', text: '定时巡检', enabled: false }],
    }).config;
    expect(computeAutonomyPolicyId(a)).not.toBe(
      computeAutonomyPolicyId(changed)
    );
  });

  it('budget ⇒ 解析为单 Ticket 上限；缺省不设上限', () => {
    const { config, errors } = parseAutonomyPolicy({
      ...VALID,
      budget: { maxTokensPerTicket: 5000, maxUsdPerTicket: 0.5 },
    });
    expect(errors).toEqual([]);
    expect(resolveTicketBudgetLimits(config)).toEqual({
      maxTokens: 5000,
      maxUsd: 0.5,
    });
    // 预算属于 Policy 版本：改上限 ⇒ 版本变化（在途工单可感知）
    const base = computeAutonomyPolicyId(parseAutonomyPolicy(VALID).config);
    expect(computeAutonomyPolicyId(config)).not.toBe(base);

    expect(
      resolveTicketBudgetLimits(parseAutonomyPolicy(VALID).config)
    ).toEqual({});
  });

  it('非法 budget（非正数 / 非对象）⇒ fail-closed', () => {
    const negative = parseAutonomyPolicy({
      ...VALID,
      budget: { maxTokensPerTicket: -1 },
    });
    expect(negative.errors.length).toBeGreaterThan(0);
    expect(negative.config.enabled).toBe(false);
    expect(negative.config.acceptMode).toBe('off');

    const notObject = parseAutonomyPolicy({ ...VALID, budget: 100 });
    expect(notObject.config.enabled).toBe(false);
    expect(notObject.errors.length).toBeGreaterThan(0);
  });
});

describe('loadAutonomyPolicy', () => {
  it('托管来源 ⇒ source=policySettings 且启用', () => {
    const loaded = loadAutonomyPolicy(() => ({
      value: VALID,
      source: 'policySettings',
    }));
    expect(loaded.source).toBe('policySettings');
    expect(loaded.config.enabled).toBe(true);
    expect(loaded.errors).toEqual([]);
    expect(loaded.policyId).toMatch(/^ps1-/);
  });

  it('读取抛错 ⇒ 默认关闭（fail-safe）', () => {
    const loaded = loadAutonomyPolicy(() => {
      throw new Error('config broken');
    });
    expect(loaded.source).toBe('defaults');
    expect(loaded.config.enabled).toBe(false);
  });
});
