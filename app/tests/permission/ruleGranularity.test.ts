// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-D1 / LRO-D2（2026-10-26 复核发现）：**指纹规则的粒度语义**与**规则键**。
 *
 * 事故实测（`dev_docs/20261026/证据/tool_rules.json`）：同一 `(file_write, 指纹)`
 * 上同时存在 allow 与 deny（相隔 1ms），且两条都只有 `inputFingerprint`、无 `contentPattern`。
 * 旧实现把"无 contentPattern 的规则"一律当**工具级**规则：
 * - 一条指纹 deny ⇒ 封锁该工具**全部**调用（且早于 ask，无审批逃生）；
 * - 一条指纹 allow ⇒ 放行该工具**任何**参数（授权放大）。
 * 且去重键不含 `inputFingerprint` ⇒ 同工具两条不同指纹 allow 互相顶掉、allow+deny 永久共存。
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  RuleManager,
  deduplicateRules,
} from '../../src/permission/RuleManager.js';
import {
  PermissionBehavior,
  createPermissionRule,
} from '../../src/permission/types/PermissionRule.js';
import { toolMatchesRule } from '../../src/permission/utils/RuleMatcher.js';
import { shadowedRuleDetector } from '../../src/permission/utils/ShadowedRuleDetector.js';

const PERMISSION_MANAGER_SRC = readFileSync(
  new URL('../../src/permission/PermissionManager.ts', import.meta.url),
  'utf8'
);

function isolatedRuleManager(): RuleManager {
  const dir = mkdtempSync(join(tmpdir(), 'liri-rules-'));
  const rm = new RuleManager();
  // 隔离落盘：不碰真实 ~/.pyapp/data/permissions/tool_rules.json
  rm.setRuleSource(join(dir, 'tool_rules.json'));
  return rm;
}

function fingerprintRule(
  behavior: PermissionBehavior,
  inputFingerprint: string,
  toolName = 'file_write'
) {
  return createPermissionRule({ behavior, toolName, inputFingerprint });
}

describe('LRO-D1：指纹规则不得参与「整体工具」匹配', () => {
  let rm: RuleManager;
  beforeEach(() => {
    rm = isolatedRuleManager();
  });

  it('指纹 deny 不再封锁整个工具（toolMatchesRule / getDenyRuleForTool）', () => {
    const deny = fingerprintRule(PermissionBehavior.DENY, 'fp-1');
    rm.addRule(deny);

    expect(toolMatchesRule('file_write', deny)).toBe(false);
    expect(rm.toolMatchesRule('file_write', deny)).toBe(false);
    expect(rm.getDenyRuleForTool('file_write')).toBeNull();
  });

  it('指纹 allow 不再放行整个工具（toolAlwaysAllowedRule）', () => {
    rm.addRule(fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'));
    expect(rm.toolAlwaysAllowedRule('file_write')).toBeNull();
  });

  it('同指纹才命中；不同指纹 / 未提供指纹一律不命中（fail-closed）', () => {
    rm.addRule(fingerprintRule(PermissionBehavior.DENY, 'fp-1'));
    const input = { file_path: 'a.txt' };

    expect(
      rm.getMatchingRule(
        'file_write',
        input,
        PermissionBehavior.DENY,
        undefined,
        {
          fingerprint: 'fp-1',
        }
      )
    ).not.toBeNull();
    expect(
      rm.getMatchingRule(
        'file_write',
        input,
        PermissionBehavior.DENY,
        undefined,
        {
          fingerprint: 'fp-2',
        }
      )
    ).toBeNull();
    expect(
      rm.getMatchingRule('file_write', input, PermissionBehavior.DENY)
    ).toBeNull();
  });

  it('PermissionManager 必须把指纹传给内容级匹配（结构守卫）', () => {
    expect(PERMISSION_MANAGER_SRC).toContain('hashApprovalFingerprint(');
    expect(PERMISSION_MANAGER_SRC).toContain('resolveApprovalFingerprint(');
    const calls = PERMISSION_MANAGER_SRC.match(/getMatchingRule\(/g) ?? [];
    expect(calls.length).toBe(3);
    const forwarded = PERMISSION_MANAGER_SRC.match(/matchOptions/g) ?? [];
    // 1 处定义 + 3 处透传
    expect(forwarded.length).toBeGreaterThanOrEqual(4);
  });
});

describe('LRO-D2：规则键必须含 inputFingerprint', () => {
  let rm: RuleManager;
  beforeEach(() => {
    rm = isolatedRuleManager();
  });

  it('同工具两条不同指纹的 allow 都能保留（旧实现会静默丢第二条）', () => {
    rm.addRule(fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'));
    rm.addRule(fingerprintRule(PermissionBehavior.ALLOW, 'fp-2'));
    expect(rm.getAllowRules()).toHaveLength(2);
  });

  it('指纹 allow 与工具级 allow 不互相顶掉', () => {
    rm.addRule(fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'));
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'file_write',
      })
    );
    expect(rm.getAllowRules()).toHaveLength(2);
    // 工具级规则仍命中"整体工具"，指纹规则不命中
    expect(rm.toolAlwaysAllowedRule('file_write')).not.toBeNull();
  });

  it('同键不同 behavior ⇒ 替换（后写为准，不留下 100% 无效的影子规则）', () => {
    rm.addRule(fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'));
    rm.addRule(fingerprintRule(PermissionBehavior.DENY, 'fp-1'));

    expect(rm.getAllowRules()).toHaveLength(0);
    expect(rm.getDenyRules()).toHaveLength(1);
    expect(rm.getDenyRules()[0].inputFingerprint).toBe('fp-1');
  });

  it('deduplicateRules 保留指纹维度', () => {
    const rules = [
      fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'),
      fingerprintRule(PermissionBehavior.ALLOW, 'fp-2'),
    ];
    expect(deduplicateRules(rules)).toHaveLength(2);
    // 同指纹同 behavior 才是重复
    expect(
      deduplicateRules([
        fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'),
        fingerprintRule(PermissionBehavior.ALLOW, 'fp-1'),
      ])
    ).toHaveLength(1);
  });

  it('影子规则检测能看到「同工具同指纹 allow + deny」（事故那对）', () => {
    const allow = fingerprintRule(PermissionBehavior.ALLOW, 'fp-1');
    const deny = fingerprintRule(PermissionBehavior.DENY, 'fp-1');
    expect(shadowedRuleDetector.detect([allow, deny]).shadowedCount).toBe(1);
    expect(shadowedRuleDetector.detect([deny, allow]).shadowedCount).toBe(1);
  });

  it('不同指纹 / 工具级 vs 指纹：不误报为互相遮蔽', () => {
    const fp1 = fingerprintRule(PermissionBehavior.DENY, 'fp-1');
    const fp2 = fingerprintRule(PermissionBehavior.ALLOW, 'fp-2');
    expect(shadowedRuleDetector.detect([fp1, fp2]).shadowedCount).toBe(0);

    const toolWideDeny = createPermissionRule({
      behavior: PermissionBehavior.DENY,
      toolName: 'file_write',
    });
    // 工具级 deny 覆盖指纹 allow（宽覆盖窄）
    expect(
      shadowedRuleDetector.detect([
        toolWideDeny,
        fingerprintRule(PermissionBehavior.ALLOW, 'fp-3'),
      ]).shadowedCount
    ).toBe(1);
    // 反向不成立（指纹更窄，不覆盖工具级）
    expect(
      shadowedRuleDetector.detect([
        fingerprintRule(PermissionBehavior.ALLOW, 'fp-3'),
        toolWideDeny,
      ]).shadowedCount
    ).toBe(0);
  });
});
