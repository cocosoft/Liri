/**
 * 静态导入图瘦身 P2 · 回归保护 —— `SecurityPermissionView` 的**惰性规则同步**
 *
 * 背景：该类原先在**构造期**读主权限模块（`new RuleManager().loadRules()`）。
 * `security ↔ permission` 是循环依赖，构造期读取的成败取决于 import 求值顺序：
 * 把 `chronos` 移出启动图后实测触发 `ReferenceError: Cannot access 'RuleManager' before initialization`，
 * 异常被 catch 吞掉 ⇒ deny 规则**静默未同步**、退回默认放行（安全姿态被悄悄削弱）。
 *
 * 本测试钉住改后的语义：
 *  ① **构造期不读**主模块（消除顺序依赖）；
 *  ② **判定前一定已同步**（deny 规则生效 ⇒ 判定返回 false）；
 *  ③ **幂等**（多次判定只同步一次）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

// ⚠️ 必须走**模块出口**（与生产同一条求值链）：直接 import `security/PermissionManager.ts`
// 会绕过 barrel 的求值顺序，触发 `SecurityIntegration → SecurityPermissionView` 的既存循环
// （`SecurityIntegration.ts:39` 在模块顶层构造单例）—— 那是**另一个**既存问题，不在本测试范围。
import { SecurityPermissionView } from '@modules/security';
import { RuleManager } from '../../src/permission/RuleManager';
import {
  PermissionBehavior,
  PermissionRuleSource,
  type PermissionRule,
} from '../../src/permission/types/PermissionRule';

const NOW = new Date('2026-10-20T00:00:00.000Z');

/** 造一条 deny bash 的主模块规则 */
function denyRule(toolName: string): PermissionRule {
  return {
    id: `deny-${toolName}`,
    behavior: PermissionBehavior.DENY,
    toolName,
    source: PermissionRuleSource.SYSTEM,
    priority: 100,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

type LoadRulesFn = () => PermissionRule[];
const proto = RuleManager.prototype as unknown as { loadRules: LoadRulesFn };
let original: LoadRulesFn;
let calls = 0;

beforeEach(() => {
  original = proto.loadRules;
  calls = 0;
  proto.loadRules = () => {
    calls++;
    return [denyRule('bash')];
  };
});

afterEach(() => {
  proto.loadRules = original;
});

describe('SecurityPermissionView · 惰性同步主模块规则', () => {
  it('构造期**不读**主模块（消除 security ↔ permission 的循环依赖时序）', () => {
    new SecurityPermissionView(true);
    expect(calls).toBe(0);
  });

  it('判定前已同步：主模块 deny 规则生效（默认 allow 也拦住）', () => {
    const view = new SecurityPermissionView(true);

    expect(view.checkToolPermission('bash')).toBe(false);
    expect(calls).toBe(1);

    // 未配置 deny 的工具仍按默认放行
    expect(view.checkToolPermission('file_read')).toBe(true);
  });

  it('幂等：多次判定只同步一次', () => {
    const view = new SecurityPermissionView(true);
    view.checkToolPermission('bash');
    view.checkToolPermission('bash');
    view.getRules();
    view.getRuleCount();
    expect(calls).toBe(1);
  });

  it('读取规则视图（getRule / exportRules）同样先同步', () => {
    const view = new SecurityPermissionView(true);
    expect(view.getRule('deny:bash')?.allowed).toBe(false);
    expect(view.exportRules().length).toBe(1);
    expect(calls).toBe(1);
  });
});
