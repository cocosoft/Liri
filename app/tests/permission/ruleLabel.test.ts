/**
 * F-01（2026-10-28）：审计 `matchedRules` 的规则标签归一。
 *
 * 背景：`PermissionDecision.rule` 是 `any`，实际常为规则对象；原实现 `String(rule)`
 * 得到 `"[object Object]"` 并被写入审计 ⇒ 安全仪表盘「越权拦截类别 Top」里出现一个
 * 叫 `[object Object]` 的虚假类别（真机实测 211 次）。
 */
import { describe, expect, it } from 'bun:test';

import { ruleLabel } from '../../src/permission/PermissionManager';

describe('ruleLabel：把规则对象归一为可读标签', () => {
  it('字符串原样返回', () => {
    expect(ruleLabel('approval:auto')).toBe('approval:auto');
  });

  it('对象按 id → ruleId → name → pattern → type 取第一个非空字符串', () => {
    expect(ruleLabel({ id: 'rule_a', name: '名称' })).toBe('rule_a');
    expect(ruleLabel({ ruleId: 'rule_b', name: '名称' })).toBe('rule_b');
    expect(ruleLabel({ name: '名称', pattern: 'rm -rf' })).toBe('名称');
    expect(ruleLabel({ pattern: 'rm -rf' })).toBe('rm -rf');
    expect(ruleLabel({ type: 'deny' })).toBe('deny');
  });

  it('绝不产出 "[object Object]"（回归锁）', () => {
    for (const value of [
      { anything: 1 },
      { id: '' },
      { id: '   ' },
      {},
      Object.create(null),
    ]) {
      expect(ruleLabel(value)).not.toBe('[object Object]');
    }
    expect(ruleLabel({ anything: 1 })).toBe('rule');
  });

  it('非对象非字符串走 String()（数字/布尔/null 不崩）', () => {
    expect(ruleLabel(1)).toBe('1');
    expect(ruleLabel(true)).toBe('true');
    expect(ruleLabel(null)).toBe('null');
    expect(ruleLabel(undefined)).toBe('undefined');
  });
});
