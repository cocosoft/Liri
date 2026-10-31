/**
 * Bug 4 回归：**工具返回空**不等于"有进展"，也不能把空结果当成新动作。
 *
 * 背景（2026-11-01）：`dev_docs/20261031/deepseek建议.md` 记录的运行时现象是
 * 「工具返回空 ⇒ 换个措辞把同一动作再做一遍」（空转）。此处钉住循环守卫对这条路的行为：
 *   · 同工具 + 同参数 + 每次结果为空 ⇒ 到达阈值即 `generic_repeat` 熔断（空结果不会刷新历史）；
 *   · 同工具 + **不同参数** ⇒ 不熔断（参数级区分，正常分页/换路径读取不得被误杀）。
 *
 * 阈值显式注入（3 次阻断），避免依赖默认的 10/20 而让用例随配置漂移。
 */
import { describe, expect, it } from 'bun:test';
import { LoopDetector } from '../../src/query/LoopDetector';

function makeDetector(): LoopDetector {
  return new LoopDetector({
    enabled: true,
    warningThreshold: 2,
    criticalThreshold: 3,
    observeOnly: false,
  });
}

describe('Bug 4 · 空结果与循环守卫', () => {
  it('同工具同参数、结果始终为空 ⇒ 达阈值即熔断（空结果不算进展）', () => {
    const detector = makeDetector();
    const args = { path: 'dev_docs/20261031/deepseek建议.md' };

    let last = detector.detect('file_read', args);
    detector.recordToolCallOutcome('file_read', args, '');
    expect(last.stuck).toBe(false); // 第 1 次不足 2 次出现，不判

    last = detector.detect('file_read', args);
    detector.recordToolCallOutcome('file_read', args, '');
    expect(last.stuck).toBe(true);
    if (last.stuck) expect(last.level).toBe('warning'); // 阈值 2 ⇒ 先警告

    last = detector.detect('file_read', args);
    detector.recordToolCallOutcome('file_read', args, '');
    expect(last.stuck).toBe(true);
    if (last.stuck) {
      expect(last.detector).toBe('generic_repeat');
      expect(last.level).toBe('critical');
    }
  });

  it('同工具不同参数（同样空结果）⇒ 不熔断（参数级区分，分页读取不被误杀）', () => {
    const detector = makeDetector();

    for (let offset = 0; offset < 5; offset++) {
      const args = { path: 'big.log', offset, limit: 100 };
      const result = detector.detect('file_read', args);
      detector.recordToolCallOutcome('file_read', args, '');
      expect(result.stuck).toBe(false);
    }
  });

  it('失败结果同样计入重复（错误不会刷新"无进展"判定）', () => {
    const detector = makeDetector();
    const args = { path: 'missing.txt' };

    detector.detect('file_read', args);
    detector.recordToolCallOutcome('file_read', args, undefined, 'ENOENT');
    detector.detect('file_read', args);
    detector.recordToolCallOutcome('file_read', args, undefined, 'ENOENT');

    const third = detector.detect('file_read', args);
    detector.recordToolCallOutcome('file_read', args, undefined, 'ENOENT');
    expect(third.stuck).toBe(true);
    if (third.stuck) expect(third.detector).toBe('generic_repeat');
  });
});
