/**
 * PlanReview 单元测试（PR4 / #8）
 *
 * 覆盖 severity 缺省策略（决策 3）——strict 由 parseReviewFromText 第 4 参显式注入：
 *   - strict=true 下缺省 severity → major（必阻塞），不再被静默放行；
 *   - strict=true 下有 issues 但全部缺 severity → 判格式不合规（pass=false）；
 *   - 显式 minor 正常放行；
 *   - strict=false 回退旧行为（缺省 minor）。
 */
import { describe, it, expect } from 'bun:test';
import { parseReviewFromText, isReviewPassed } from './PlanReview.js';

describe('parseReviewFromText severity 缺省策略（PR4/#8）', () => {
  it('strict 下缺省 severity 提升为 major 并阻塞', () => {
    const review = parseReviewFromText(
      JSON.stringify({
        pass: true,
        score: 80,
        issues: [{ description: 'LLM 未输出 severity' }],
      }),
      'step-1',
      undefined,
      true
    );
    expect(review.issues[0]?.severity).toBe('major');
    // major 是阻塞级 → 门不通过（修复前会因 minor 被放行）
    expect(isReviewPassed(review)).toBe(false);
  });

  it('strict 下有 issues 但全部缺 severity → 格式不合规，pass=false', () => {
    const review = parseReviewFromText(
      JSON.stringify({
        pass: true,
        score: 70,
        issues: [{ description: 'a' }, { description: 'b' }],
      }),
      'step-1',
      undefined,
      true
    );
    expect(review.issues.every((i) => i.severity === 'major')).toBe(true);
    expect(review.pass).toBe(false);
  });

  it('显式 minor 正常放行', () => {
    const review = parseReviewFromText(
      JSON.stringify({
        pass: true,
        score: 95,
        issues: [{ severity: 'minor', description: 'nit' }],
      }),
      'step-1',
      undefined,
      true
    );
    expect(review.issues[0]?.severity).toBe('minor');
    expect(isReviewPassed(review)).toBe(true);
  });

  it('strict=false 回退旧行为（缺省 minor）', () => {
    const review = parseReviewFromText(
      JSON.stringify({
        pass: true,
        score: 80,
        issues: [{ description: '无 severity' }],
      }),
      'step-1',
      undefined,
      false
    );
    expect(review.issues[0]?.severity).toBe('minor');
    expect(isReviewPassed(review)).toBe(true);
  });
});
