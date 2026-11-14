/**
 * P2-1 统一 Rule 模型（纯函数）自证（2026-11-03）。
 *
 * 钉死：四来源投影 → 统一规则；去重/优先级；B 体系 whitelist 兜底；dry-run diff。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  permissionRulesToUnified,
  settingsToUnified,
  commandRulesToUnified,
  standingRulesToUnified,
  mergeUnifiedRules,
  diffUnifiedRules,
  groupBySource,
  parseSettingsRuleText,
  renderRuleSourceDocRows,
} from '@openliri/infra/permission';
import {
  PermissionBehavior,
  PermissionRuleSource,
} from '@openliri/infra/permission';
import type { PermissionRule, StandingRule } from '@openliri/infra/permission';
import { skillPath } from '../../../scripts/lib/skillPaths';

const REPO_ROOT = join(process.cwd(), '..');

function rule(over: Partial<PermissionRule>): PermissionRule {
  const now = new Date();
  return {
    id: over.id ?? 'r1',
    behavior: over.behavior ?? PermissionBehavior.ALLOW,
    toolName: over.toolName ?? 'bash',
    source: over.source ?? PermissionRuleSource.RULE_STORE,
    priority: over.priority ?? 1,
    createdAt: now,
    updatedAt: now,
    ...(over.contentPattern ? { contentPattern: over.contentPattern } : {}),
    ...(over.inputFingerprint
      ? { inputFingerprint: over.inputFingerprint }
      : {}),
  };
}

describe('unifiedRule：四来源投影', () => {
  it('A 体系：无 contentPattern ⇒ tool，有 ⇒ call，来源保留 ruleStore', () => {
    const u = permissionRulesToUnified([
      rule({ toolName: 'bash' }),
      rule({ id: 'r2', toolName: 'bash', contentPattern: 'npm run test:*' }),
    ]);
    expect(u[0]!.scope).toBe('tool');
    expect(u[1]!.scope).toBe('call');
    expect(u[1]!.source).toBe('ruleStore');
    expect(u[1]!.removableVia).toContain('permissions/rules');
  });

  it('settings：解析 Bash(npm run test:*) 并保留来源', () => {
    expect(parseSettingsRuleText('Bash(npm run test:*)')).toEqual({
      toolName: 'Bash',
      contentPattern: 'npm run test:*',
    });
    expect(parseSettingsRuleText('  ')).toBeNull();
    const u = settingsToUnified({
      source: PermissionRuleSource.USER_SETTINGS,
      allow: ['Read'],
      deny: ['Bash(rm:*)'],
      ask: [],
    });
    expect(u).toHaveLength(2);
    expect(u.map((r) => r.behavior).sort()).toEqual(['allow', 'deny']);
    expect(u.every((r) => r.source === 'userSettings')).toBe(true);
    expect(u.every((r) => r.removableVia.includes('settings.json'))).toBe(true);
  });

  it('B 体系：黑名单 deny；whitelist 非空追加「未命中即拒绝」兜底', () => {
    const u = commandRulesToUnified({
      blacklist: [{ pattern: 'rm -rf' }],
      whitelist: [{ pattern: 'git status', matchType: 'prefix' }],
      mode: 'whitelist',
    });
    expect(u.filter((r) => r.behavior === 'deny')).toHaveLength(2);
    expect(u.filter((r) => r.behavior === 'allow')).toHaveLength(1);
    const empty = commandRulesToUnified({
      blacklist: [],
      whitelist: [],
      mode: 'whitelist',
    });
    expect(empty).toHaveLength(0); // 空白名单视为未配置（与 commandRulePolicy 同口径）
  });

  it('StandingRule：任务级 allow，target 为空 ⇒ *，保留 expiresAt', () => {
    const standing: StandingRule = {
      toolName: 'send_email',
      allowedTargets: new Set<string>(),
      createdBy: 'task-1',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const u = standingRulesToUnified([standing]);
    expect(u).toHaveLength(1);
    expect(u[0]!.scope).toBe('task');
    expect(u[0]!.matcher.target).toBe('*');
    expect(u[0]!.expiresAt).toBe(standing.expiresAt);
  });
});

describe('unifiedRule：合并 / 差异 / 分组', () => {
  it('合并去重保留高优先级；按来源分组', () => {
    const a = permissionRulesToUnified([rule({ toolName: 'bash' })]);
    const b = settingsToUnified({
      source: PermissionRuleSource.USER_SETTINGS,
      allow: ['bash'],
      deny: [],
      ask: [],
    });
    const merged = mergeUnifiedRules([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe('ruleStore'); // 100 > 60
    expect(Object.keys(groupBySource(merged))).toEqual(['ruleStore']);
  });

  it('diff：新增 / 移除 / 变更', () => {
    const before = permissionRulesToUnified([
      rule({ toolName: 'bash' }),
      rule({ id: 'r2', toolName: 'read' }),
    ]);
    const after = permissionRulesToUnified([
      rule({ toolName: 'bash', behavior: PermissionBehavior.DENY }),
    ]);
    const diff = diffUnifiedRules(before, after);
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });
});

describe('P3-4：权限速查表由统一 Rule 模型生成', () => {
  it('渲染出 A / B 两行，且入口与配置键来自模型', () => {
    const rows = renderRuleSourceDocRows().split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('A 工具级规则');
    expect(rows[0]).toContain('tool_rules.json');
    expect(rows[1]).toContain('B 命令级黑白名单');
    expect(rows[1]).toContain('permission.customRules.commandRules');
  });

  it('内置技能 update-config 不再手抄 A/B 行（只内插生成结果）', () => {
    const src = readFileSync(
      skillPath(REPO_ROOT, 'loaders/sources/BundledSkillLoader.ts'),
      'utf8'
    );
    expect(src).toContain('${renderRuleSourceDocRows()}');
    expect(src).not.toContain('| A 工具级规则 |');
  });
});
