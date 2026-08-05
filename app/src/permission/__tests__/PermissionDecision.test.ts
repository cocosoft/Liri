/**
 * 权限决策核心单测（P3-12）
 *
 * 覆盖：规则匹配纯函数、RuleManager 增删查与持久化、PermissionManager 决策
 * （deny 优先 / 内容模式 / ask / 白名单 / fail-closed 默认行为）。
 *
 * CI 回归防护：fail-closed（PERMISSION_DEFAULT_BEHAVIOR=deny）与
 * "默认放行可观测" 路径必须有断言，防止被静默改回。
 */

import { PermissionManager } from '../PermissionManager';
import { RuleManager } from '../RuleManager';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  isRuleMatch,
  isToolNameMatch,
  matchGlob,
} from '../types/PermissionRule';
import { PermissionDecisionType } from '../types/PermissionDecision';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 已创建的临时目录，afterAll 统一清理 */
const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

/** 创建使用独立临时规则文件的 PermissionManager 实例 */
function createIsolatedManager(
  defaultBehavior: 'allow' | 'deny' = 'allow'
): PermissionManager {
  const tmpDir = mkdtempSync(join(tmpdir(), 'perm-test-'));
  tmpDirs.push(tmpDir);
  const ruleFile = join(tmpDir, 'tool_rules.json');
  writeFileSync(ruleFile, '[]');

  const prev = process.env.PERMISSION_DEFAULT_BEHAVIOR;
  process.env.PERMISSION_DEFAULT_BEHAVIOR = defaultBehavior;
  const pm = new PermissionManager();
  if (prev === undefined) {
    delete process.env.PERMISSION_DEFAULT_BEHAVIOR;
  } else {
    process.env.PERMISSION_DEFAULT_BEHAVIOR = prev;
  }

  pm.getRuleManager().setRuleSource(ruleFile);
  pm.getRuleManager().clearRules();
  return pm;
}

describe('权限规则匹配纯函数', () => {
  it('globToRegex/matchGlob 精确匹配', () => {
    expect(matchGlob('Bash', 'Bash')).toBe(true);
    expect(matchGlob('WebSearch', 'Bash')).toBe(false);
  });

  it('glob 通配符匹配', () => {
    expect(matchGlob('Bash', 'B*')).toBe(true);
    expect(matchGlob('WebSearch', '*Search')).toBe(true);
    expect(matchGlob('WebSearch', '*')).toBe(true);
  });

  it('isToolNameMatch 精确与 glob', () => {
    expect(isToolNameMatch('Bash', 'Bash')).toBe(true);
    expect(isToolNameMatch('Bash', 'B*')).toBe(true);
    expect(isToolNameMatch('Bash', 'WebSearch')).toBe(false);
  });

  it('isRuleMatch 内容模式正则匹配输入', () => {
    const rule = {
      id: 'r1',
      behavior: PermissionBehavior.DENY,
      toolName: 'Bash',
      contentPattern: 'rm -rf',
      source: PermissionRuleSource.USER_SETTINGS,
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(isRuleMatch(rule, 'Bash', { command: 'rm -rf /' })).toBe(true);
    expect(isRuleMatch(rule, 'Bash', { command: 'ls -la' })).toBe(false);
    // 工具名不匹配时，即使内容命中也不匹配
    expect(isRuleMatch(rule, 'WebSearch', { command: 'rm -rf /' })).toBe(false);
  });
});

describe('RuleManager 规则管理（临时文件隔离）', () => {
  function createIsolatedRuleManager(): { rm: RuleManager; ruleFile: string } {
    const tmpDir = mkdtempSync(join(tmpdir(), 'perm-rm-'));
    tmpDirs.push(tmpDir);
    const ruleFile = join(tmpDir, 'tool_rules.json');
    writeFileSync(ruleFile, '[]');
    const rm = new RuleManager();
    rm.setRuleSource(ruleFile);
    rm.clearRules();
    return { rm, ruleFile };
  }

  it('addRule 持久化，新实例可从文件读回', () => {
    const { rm, ruleFile } = createIsolatedRuleManager();
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'Bash',
        contentPattern: 'rm -rf',
      })
    );
    expect(rm.getRules()).toHaveLength(1);

    const rm2 = new RuleManager();
    rm2.setRuleSource(ruleFile);
    const loaded = rm2.loadRules();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].toolName).toBe('Bash');
    expect(loaded[0].behavior).toBe(PermissionBehavior.DENY);
    expect(loaded[0].contentPattern).toBe('rm -rf');
  });

  it('removeRule 删除指定规则', () => {
    const { rm } = createIsolatedRuleManager();
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'A',
      })
    );
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'B',
      })
    );
    expect(rm.getRules()).toHaveLength(2);

    const toRemove = rm.getRules().find((r) => r.toolName === 'A')!;
    rm.removeRule(toRemove);
    const remaining = rm.getRules();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].toolName).toBe('B');
  });

  it('getRules 按优先级降序排序', () => {
    const { rm } = createIsolatedRuleManager();
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'Low',
        priority: 1,
      })
    );
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'High',
        priority: 9,
      })
    );
    const rules = rm.getRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].toolName).toBe('High');
    expect(rules[1].toolName).toBe('Low');
  });

  it('getRulesByBehavior 按行为分组', () => {
    const { rm } = createIsolatedRuleManager();
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.ALLOW,
        toolName: 'A',
      })
    );
    rm.addRule(
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'B',
      })
    );
    expect(rm.getAllowRules()).toHaveLength(1);
    expect(rm.getDenyRules()).toHaveLength(1);
    expect(rm.getAskRules()).toHaveLength(0);
  });
});

describe('PermissionManager 决策（P0-2/P1-5 回归防护）', () => {
  it('默认放行：无规则匹配 → allow（reason 含 No matching rules）', async () => {
    const pm = createIsolatedManager('allow');
    const decision = await pm.checkPermission('TestToolDefaultAllow', {});
    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
    expect(decision.reason).toContain('No matching rules');
  });

  it('fail-closed：PERMISSION_DEFAULT_BEHAVIOR=deny 时无规则匹配 → deny', async () => {
    const pm = createIsolatedManager('deny');
    const decision = await pm.checkPermission('TestToolDefaultDeny', {});
    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });

  it('deny 规则优先于 allow 规则', async () => {
    const pm = createIsolatedManager();
    pm.addRule(PermissionBehavior.ALLOW, 'TestToolConflict');
    pm.addRule(PermissionBehavior.DENY, 'TestToolConflict');
    const decision = await pm.checkPermission('TestToolConflict', {});
    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });

  it('allow 白名单规则放行（fail-closed 下仍生效）', async () => {
    const pm = createIsolatedManager('deny');
    pm.addRule(PermissionBehavior.ALLOW, 'TestToolAllowlist');
    const decision = await pm.checkPermission('TestToolAllowlist', {});
    expect(decision.type).toBe(PermissionDecisionType.ALLOW);
  });

  it('ask 规则返回 ask', async () => {
    const pm = createIsolatedManager();
    pm.addRule(PermissionBehavior.ASK, 'TestToolAsk');
    const decision = await pm.checkPermission('TestToolAsk', {});
    expect(decision.type).toBe(PermissionDecisionType.ASK);
  });

  it('内容模式 deny：命中拒绝、未命中放行', async () => {
    const pm = createIsolatedManager();
    pm.addRule(PermissionBehavior.DENY, 'TestToolContent', 'rm -rf');
    const denied = await pm.checkPermission('TestToolContent', {
      command: 'rm -rf /',
    });
    expect(denied.type).toBe(PermissionDecisionType.DENY);

    const allowed = await pm.checkPermission('TestToolContent', {
      command: 'ls -la',
    });
    expect(allowed.type).toBe(PermissionDecisionType.ALLOW);
  });

  it('glob 工具规则匹配', async () => {
    const pm = createIsolatedManager('deny');
    pm.addRule(PermissionBehavior.DENY, 'TestTool*');
    const decision = await pm.checkPermission('TestToolGlobMatch', {});
    expect(decision.type).toBe(PermissionDecisionType.DENY);
  });
});
