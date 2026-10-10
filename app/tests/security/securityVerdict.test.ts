/**
 * P0-3 —— 统一安全决策词汇（`security-decision-verdict.md` §5）。
 *
 * 覆盖：四态映射 / 单调合并（**绝不放宽**）/ 放行判定 / 深扫状态裁决，
 * 以及 code_run 静态校验的 `scanStatus` **可区分性**（未扫描 ≠ 扫描通过）。
 */
import { describe, expect, it } from 'bun:test';

import {
  SECURITY_VERDICTS,
  combineVerdicts,
  isPermissive,
  verdictFromBehavior,
  verdictFromScanStatus,
} from '../../src/security/decision.js';
import { validateCodeRunnerCode } from '../../src/tools/CodeRunner/staticValidation.js';

describe('security/decision · 统一四态词汇', () => {
  it('既有三态 SecurityBehavior → 统一四态（确定映射，不产生 INDETERMINATE）', () => {
    expect(verdictFromBehavior('allow')).toBe('ALLOW');
    expect(verdictFromBehavior('deny')).toBe('DENY');
    expect(verdictFromBehavior('ask')).toBe('REQUIRE_REVIEW');
  });

  it('SECURITY_VERDICTS 恰为四态（枚举闭集）', () => {
    expect([...SECURITY_VERDICTS].sort()).toEqual(
      ['ALLOW', 'DENY', 'INDETERMINATE', 'REQUIRE_REVIEW'].sort()
    );
  });

  it('combineVerdicts 取最严：DENY > REQUIRE_REVIEW > INDETERMINATE > ALLOW', () => {
    expect(combineVerdicts(['ALLOW', 'REQUIRE_REVIEW'])).toBe('REQUIRE_REVIEW');
    expect(combineVerdicts(['ALLOW', 'INDETERMINATE'])).toBe('INDETERMINATE');
    expect(combineVerdicts(['REQUIRE_REVIEW', 'DENY'])).toBe('DENY');
    expect(combineVerdicts(['ALLOW', 'ALLOW'])).toBe('ALLOW');
  });

  it('combineVerdicts 单调：合并结果绝不放宽任一层结论', () => {
    // 只要有一层不确定 ⇒ 结果不可能回到 ALLOW（这正是要消除的折叠）
    const cases: Array<
      Array<'ALLOW' | 'DENY' | 'REQUIRE_REVIEW' | 'INDETERMINATE'>
    > = [
      ['ALLOW', 'INDETERMINATE', 'ALLOW'],
      ['INDETERMINATE', 'REQUIRE_REVIEW'],
      ['ALLOW', 'DENY', 'ALLOW'],
    ];
    for (const vs of cases) {
      expect(isPermissive(combineVerdicts(vs))).toBe(false);
    }
  });

  it('空输入 ⇒ INDETERMINATE（无结论 ≠ 放行）', () => {
    expect(combineVerdicts([])).toBe('INDETERMINATE');
  });

  it('isPermissive 仅对 ALLOW 为真', () => {
    expect(isPermissive('ALLOW')).toBe(true);
    expect(isPermissive('INDETERMINATE')).toBe(false);
    expect(isPermissive('REQUIRE_REVIEW')).toBe(false);
    expect(isPermissive('DENY')).toBe(false);
  });

  it('verdictFromScanStatus：仅 ran 放行；skipped/failed 收紧或不确定（两者都不放行）', () => {
    expect(verdictFromScanStatus('ran', false)).toBe('ALLOW');
    expect(verdictFromScanStatus('ran', true)).toBe('ALLOW');
    // 未执行 / 失败 —— 非严格 ⇒ INDETERMINATE；严格 ⇒ REQUIRE_REVIEW
    expect(verdictFromScanStatus('skipped', false)).toBe('INDETERMINATE');
    expect(verdictFromScanStatus('skipped', true)).toBe('REQUIRE_REVIEW');
    expect(verdictFromScanStatus('failed', false)).toBe('INDETERMINATE');
    expect(verdictFromScanStatus('failed', true)).toBe('REQUIRE_REVIEW');
    // 语义红线：skipped/failed 在任一姿态下都**不放行**
    expect(isPermissive(verdictFromScanStatus('skipped', false))).toBe(false);
    expect(isPermissive(verdictFromScanStatus('failed', true))).toBe(false);
  });
});

describe('code_run 静态校验 · scanStatus 可区分性（P0-3）', () => {
  it('语法错误早退 ⇒ scanStatus=skipped（尚未到达深扫步骤，≠ 扫描通过）', () => {
    const result = validateCodeRunnerCode('const x = (');
    expect(result.ok).toBe(false);
    expect(result.scanStatus).toBe('skipped');
  });

  it('scanStatus 恒为三态之一（枚举闭集，供调用方判定）', () => {
    const result = validateCodeRunnerCode('export const value = 1;');
    expect(['ran', 'skipped', 'failed']).toContain(result.scanStatus);
  });
});
