// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R0（2026-11-17）规则治理只读层 —— 作用域推导 + 规则文件健康视图。
 *
 * 锁三件事：
 * 1. `scope` / `readOnly` 是**派生字段**（不落盘），推导必须如实反映真实生效范围；
 * 2. `getRuleFileHealth()` **纯只读**：只报告磁盘事实，不重载、不写文件；
 * 3. 手工编辑规则文件产生的"同键不同行为"冲突必须显式暴露（此前只能翻日志）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RuleManager,
  buildRuleConflictKey,
} from '@openliri/infra/permission/RuleManager';
import {
  describePermissionRuleScope,
  isApprovalOriginatedRule,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';
import { serializeRule } from '../../src/infrastructure/http/handlers/permission-handlers';

/** 写规则文件（绕过 RuleManager，模拟"手工编辑"） */
function writeRulesFile(
  file: string,
  rules: Array<Record<string, unknown>>
): void {
  writeFileSync(file, JSON.stringify(rules, null, 2));
}

function rule(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    behavior: 'allow',
    toolName: 'bash',
    source: 'ruleStore',
    priority: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 测试夹具 → 规则模型（日期是字符串，序列化函数本身兼容） */
function asRule(value: Record<string, unknown>): PermissionRule {
  return value as unknown as PermissionRule;
}

describe('R0：规则作用域推导（派生字段，不落盘）', () => {
  it('无匹配条件 ⇒ tool；有内容条件 / 指纹 ⇒ global；有 workspaceRoot ⇒ workspace', () => {
    expect(describePermissionRuleScope({})).toBe('tool');
    expect(describePermissionRuleScope({ contentPattern: '^git ' })).toBe(
      'global'
    );
    expect(describePermissionRuleScope({ inputFingerprint: 'fp' })).toBe(
      'global'
    );
    expect(
      describePermissionRuleScope({
        contentPattern: '^npm run build$',
        workspaceRoot: 'E:/work',
      })
    ).toBe('workspace');
  });

  it('审批生成的两种形态（指纹 / 本工作区信任）标记只读，普通规则可编辑', () => {
    expect(isApprovalOriginatedRule({ inputFingerprint: 'fp' })).toBe(true);
    expect(isApprovalOriginatedRule({ workspaceRoot: 'E:/work' })).toBe(true);
    expect(isApprovalOriginatedRule({ contentPattern: '^git ' })).toBe(false);
    expect(isApprovalOriginatedRule({})).toBe(false);
  });

  it('列表 DTO 带 scope/readOnly，且 readOnly 不写回规则对象', () => {
    const raw = rule('r1', { inputFingerprint: 'abc123', priority: 1 });
    const dto = serializeRule(asRule(raw));
    expect(dto['scope']).toBe('global');
    expect(dto['readOnly']).toBe(true);
    expect(dto['workspaceRoot']).toBeUndefined();
    // 派生字段不得污染规则模型本身（否则会被 saveRules 落盘）
    expect(raw['readOnly']).toBeUndefined();

    const plain = serializeRule(
      asRule(rule('r2', { contentPattern: '^git ' }))
    );
    expect(plain['scope']).toBe('global');
    expect(plain['readOnly']).toBe(false);
  });
});

describe('R0：规则文件健康视图（纯只读）', () => {
  let dir: string;
  let file: string;
  let manager: RuleManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liri-rule-health-'));
    file = join(dir, 'tool_rules.json');
    manager = new RuleManager();
    manager.setRuleSource(file);
    manager.loadRules();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('文件不存在 ⇒ exists=false、hash/count 为 null（不编造）', () => {
    const health = manager.getRuleFileHealth();
    expect(health.exists).toBe(false);
    expect(health.fileHash).toBeNull();
    expect(health.loadedHash).toBeNull();
    expect(health.fileRuleCount).toBeNull();
    expect(health.parseError).toBeNull();
    expect(health.externalChangeDetected).toBe(false);
    expect(health.memoryRuleCount).toBe(0);
    expect(health.conflicts).toEqual([]);
  });

  it('已加载且未被外部修改 ⇒ 磁盘/内存一致、无冲突无重复', () => {
    writeRulesFile(file, [
      rule('r1', { behavior: 'allow', contentPattern: '^git ' }),
      rule('r2', { behavior: 'deny', toolName: 'file_write' }),
    ]);
    manager.loadRules();

    const health = manager.getRuleFileHealth();
    expect(health.exists).toBe(true);
    expect(health.sizeBytes).toBeGreaterThan(0);
    expect(health.lastModified).not.toBeNull();
    expect(health.fileRuleCount).toBe(2);
    expect(health.memoryRuleCount).toBe(2);
    expect(health.parseError).toBeNull();
    expect(health.duplicateCount).toBe(0);
    expect(health.conflicts).toEqual([]);
    expect(health.externalChangeDetected).toBe(false);
    expect(health.fileHash).toBe(health.loadedHash);
  });

  it('外部修改未重载 ⇒ externalChangeDetected=true，且健康视图本身不触发重载', () => {
    writeRulesFile(file, [rule('r1', { contentPattern: '^git ' })]);
    manager.loadRules();
    const loadedHash = manager.getRuleFileHealth().loadedHash;

    writeRulesFile(file, [
      rule('r1', { contentPattern: '^git ' }),
      rule('r2', { behavior: 'deny', contentPattern: '^rm ' }),
    ]);

    const health = manager.getRuleFileHealth();
    expect(health.externalChangeDetected).toBe(true);
    expect(health.fileHash).not.toBe(loadedHash);
    expect(health.fileRuleCount).toBe(2);
    // 只读：不重载 ⇒ 内存仍是 1 条
    expect(health.memoryRuleCount).toBe(1);
  });

  it('手工编辑出同键不同行为 ⇒ conflicts 暴露（allow/deny 并存）', () => {
    writeRulesFile(file, [
      rule('r1', { behavior: 'allow', contentPattern: '^git ' }),
      rule('r2', { behavior: 'deny', contentPattern: '^git ' }),
    ]);

    const health = manager.getRuleFileHealth();
    expect(health.conflicts).toHaveLength(1);
    expect(health.conflicts[0]!.behaviors.sort()).toEqual(['allow', 'deny']);
    expect(health.conflicts[0]!.ids.sort()).toEqual(['r1', 'r2']);
    // 同键同行为才算重复；allow/deny 不算
    expect(health.duplicateCount).toBe(0);
  });

  it('跨来源同键不同行为 ⇒ 也报冲突（冲突键不含 source，评审 P0-3）', () => {
    writeRulesFile(file, [
      rule('r1', {
        behavior: 'allow',
        contentPattern: '^git ',
        source: 'ruleStore',
      }),
      rule('r2', {
        behavior: 'deny',
        contentPattern: '^git ',
        source: 'userSettings',
      }),
    ]);

    const health = manager.getRuleFileHealth();
    expect(health.conflicts).toHaveLength(1);
    expect(health.conflicts[0]!.behaviors.sort()).toEqual(['allow', 'deny']);
  });

  it('冲突键：只含匹配维度（工具/内容/指纹/工作区根），不含来源与行为', () => {
    const base = { toolName: 'bash', contentPattern: '^git ' };
    expect(buildRuleConflictKey(base)).toBe('bash|^git ||');
    // 含 workspaceRoot ⇒ 不同工作区不误报
    expect(buildRuleConflictKey(base)).not.toBe(
      buildRuleConflictKey({ ...base, workspaceRoot: 'E:/work' })
    );
  });

  it('同键同行为的重复条目 ⇒ duplicateCount 计数', () => {
    writeRulesFile(file, [
      rule('r1', { behavior: 'allow', contentPattern: '^git ' }),
      rule('r2', { behavior: 'allow', contentPattern: '^git ' }),
    ]);
    const health = manager.getRuleFileHealth();
    expect(health.duplicateCount).toBe(1);
    expect(health.conflicts).toEqual([]);
  });

  it('文件损坏 ⇒ parseError 非空、fileRuleCount=null，内存规则不受影响', () => {
    writeRulesFile(file, [rule('r1', { contentPattern: '^git ' })]);
    manager.loadRules();
    expect(manager.getRuleFileHealth().memoryRuleCount).toBe(1);

    writeFileSync(file, '{ this is not json');
    const health = manager.getRuleFileHealth();
    expect(health.exists).toBe(true);
    expect(health.parseError).not.toBeNull();
    expect(health.fileRuleCount).toBeNull();
    expect(health.memoryRuleCount).toBe(1);
  });

  it('顶层不是数组 ⇒ 同样报 parseError（不把对象当规则列表）', () => {
    writeFileSync(file, JSON.stringify({ rules: [] }));
    const health = manager.getRuleFileHealth();
    expect(health.parseError).toContain('数组');
    expect(health.fileRuleCount).toBeNull();
  });
});
