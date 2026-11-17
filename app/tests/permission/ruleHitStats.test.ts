// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R5（2026-11-17）：按规则维度的命中计数（R3 `hitCount` / ⑤「90 天未命中」的数据源）。
 *
 * 锁四件事：
 * 1. **口径**：只统计"决策由某条规则给出"的真实判定；`simulate` 不计数；
 * 2. **持久化**：节流写盘到 `rule_hits.json`（路径可用 env 覆盖）；
 * 3. **未命中判定**：`now - (lastHitAt ?? createdAt) >= 90 天`；
 * 4. **观察期闸**：开始计数不足 90 天 ⇒ 不产出"未命中"结论（不误报）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import {
  buildRuleHitReport,
  flushRuleHitStats,
  getRuleHitEntry,
  readRuleHitStats,
  recordRuleHit,
  resetRuleHitStatsForTest,
  resolveRuleHitStatsPath,
  RULE_HIT_STALE_DAYS,
  type RuleHitStatsSnapshot,
} from '@openliri/infra/permission';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

let dir: string;
const savedEnv = process.env.PERMISSION_RULE_HIT_STATS;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rule-hits-'));
  process.env.PERMISSION_RULE_HIT_STATS = join(dir, 'rule_hits.json');
  resetRuleHitStatsForTest();
});

afterEach(() => {
  resetRuleHitStatsForTest();
  if (savedEnv === undefined) delete process.env.PERMISSION_RULE_HIT_STATS;
  else process.env.PERMISSION_RULE_HIT_STATS = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

function rule(overrides: Partial<PermissionRule> = {}): PermissionRule {
  const createdAt = new Date(NOW - 200 * DAY);
  return {
    ...createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git ',
      source: PermissionRuleSource.RULE_STORE,
    }),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('R5：命中计数（记录 / 持久化）', () => {
  it('recordRuleHit 累加 count、维护首末命中时间', () => {
    recordRuleHit('rule_a', NOW - 1000);
    recordRuleHit('rule_a', NOW);
    const entry = getRuleHitEntry('rule_a');
    expect(entry?.count).toBe(2);
    expect(entry?.firstHitAt).toBe(NOW - 1000);
    expect(entry?.lastHitAt).toBe(NOW);
    // 未命中过的规则 ⇒ 无条目
    expect(getRuleHitEntry('rule_missing')).toBeUndefined();
  });

  it('flush 写盘到 rule_hits.json（含 countingSince）；空 ruleId 不计数', () => {
    recordRuleHit('');
    recordRuleHit('rule_a', NOW);
    flushRuleHitStats();

    const path = resolveRuleHitStatsPath();
    expect(path).toBe(join(dir, 'rule_hits.json'));
    expect(existsSync(path)).toBe(true);
    const persisted = JSON.parse(
      readFileSync(path, 'utf8')
    ) as RuleHitStatsSnapshot;
    expect(persisted.version).toBe(1);
    expect(typeof persisted.countingSince).toBe('number');
    expect(persisted.rules['rule_a']?.count).toBe(1);
    expect(Object.keys(persisted.rules)).toEqual(['rule_a']);
  });
});

describe('R5：90 天未命中报告（纯函数）', () => {
  const stats = (
    countingSince: number,
    rules: RuleHitStatsSnapshot['rules'] = {}
  ): RuleHitStatsSnapshot => ({ version: 1, countingSince, rules });

  it('观察期不足 90 天 ⇒ observationComplete=false 且不列规则', () => {
    const report = buildRuleHitReport([rule()], stats(NOW - 30 * DAY), NOW);
    expect(report.observationComplete).toBe(false);
    expect(report.observationDays).toBe(30);
    expect(report.staleDays).toBe(RULE_HIT_STALE_DAYS);
    expect(report.staleRules).toEqual([]);
  });

  it('观察期满：从未命中且规则已存在 ≥90 天 ⇒ 列为未命中', () => {
    const report = buildRuleHitReport([rule()], stats(NOW - 200 * DAY), NOW);
    expect(report.observationComplete).toBe(true);
    expect(report.staleRules.map((r) => r.ruleId)).toHaveLength(1);
    expect(report.staleRules[0]!.lastHitAt).toBeNull();
  });

  it('最近 90 天内命中过 ⇒ 不算未命中；新建不久的规则也不算', () => {
    const hitRule = rule({ id: 'rule_hit' });
    const freshRule = rule({
      id: 'rule_fresh',
      createdAt: new Date(NOW - 10 * DAY),
      updatedAt: new Date(NOW - 10 * DAY),
    });
    const report = buildRuleHitReport(
      [hitRule, freshRule],
      stats(NOW - 200 * DAY, {
        rule_hit: {
          count: 3,
          firstHitAt: NOW - 20 * DAY,
          lastHitAt: NOW - 5 * DAY,
        },
      }),
      NOW
    );
    expect(report.staleRules).toEqual([]);
  });

  it('多条未命中按最近命中时间升序（最久未用在前）', () => {
    const older = rule({
      id: 'rule_older',
      createdAt: new Date(NOW - 300 * DAY),
    });
    const newer = rule({
      id: 'rule_newer',
      createdAt: new Date(NOW - 120 * DAY),
    });
    const report = buildRuleHitReport(
      [newer, older],
      stats(NOW - 400 * DAY),
      NOW
    );
    expect(report.staleRules.map((r) => r.ruleId)).toEqual([
      'rule_older',
      'rule_newer',
    ]);
  });
});

describe('R5：判定链计数（真实判定计数、模拟不计数）', () => {
  it('default 档 allow 规则命中 ⇒ count+1；simulate 不改变计数', async () => {
    const ruleFile = join(dir, 'tool_rules.json');
    const manager = new PermissionManager();
    manager.getRuleManager().setRuleSource(ruleFile);
    manager.getRuleManager().loadRules();
    manager.setToolPermissionContext({
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    });
    manager.setMode('default');

    const allowRule = createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName: 'bash',
      contentPattern: '^git status',
      source: PermissionRuleSource.RULE_STORE,
    });
    manager.getRuleManager().addRule(allowRule);

    const decision = await manager.checkPermission('bash', {
      command: 'git status',
    });
    expect(String(decision.type)).toBe('allow');
    expect(getRuleHitEntry(allowRule.id)?.count).toBe(1);

    // simulate 复用同一判定链但**不写任何状态** ⇒ 不得计数
    await manager.simulatePermission({
      toolName: 'bash',
      input: { command: 'git status' },
      mode: 'default',
    });
    expect(getRuleHitEntry(allowRule.id)?.count).toBe(1);
    expect(readRuleHitStats().rules[allowRule.id]?.count).toBe(1);
  });
});
