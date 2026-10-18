/**
 * SB07 / U-19 阶段 C：交接单生成器（`scripts/gen-handoff.ts`）的输出契约。
 *
 * 覆盖：
 * ① ≤30 行（SB07）、每行 ≤300 字符（SB03）—— 即使 doneKeys / nextAction 很长；
 * ② 键集合与 nextAction 不被截断（折行而非丢弃）；
 * ③ 空 `doneKeys` 显式渲染「（无）」，不伪造完成项。
 */
import { describe, expect, it } from 'bun:test';
import { renderHandoff } from '../../../scripts/gen-handoff';

const LONG_NEXT_ACTION =
  'U-22/H-1 余：i18n zh/en（6487 / 6725，按顶层 namespace 切文件 + i18nKeyParity 守卫）与 ChatManager 4238（余 +2238，11-30 到期）；U-20 继续 B5-2-101+（provider 站点/示例文案）；U-13 编排 P50/P95 待真实编排流量；U-17 已按结构闭合代理指标关闭（重开条件见 AST §8.6⑥）';

describe('gen-handoff（SB07）', () => {
  it('长 doneKeys + 长 nextAction ⇒ ≤30 行且每行 ≤300 字符', () => {
    const doneKeys = Array.from({ length: 42 }, (_, i) => `KEY-${i}`);
    const lines = renderHandoff({
      nextKey: 'B5-2-101',
      doneKeys,
      lastCommit: 'abcdef123',
      baselineKeys: { 'lint:consts': 82, 'lint:endpoints': 30 },
      nextAction: LONG_NEXT_ACTION,
    });

    expect(lines.length).toBeLessThanOrEqual(30);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(300);
    }
    const text = lines.join('\n');
    expect(text).toContain('B5-2-101');
    expect(text).toContain('abcdef123');
    expect(text).toContain('lint:consts=82');
    // 折行不丢键
    for (const key of doneKeys) expect(text).toContain(key);
  });

  it('空 doneKeys ⇒ 显式「（无）」', () => {
    const lines = renderHandoff({
      nextKey: 'X',
      doneKeys: [],
      nextAction: 'do it',
    });
    expect(lines.join('\n')).toContain('（无）');
  });
});
