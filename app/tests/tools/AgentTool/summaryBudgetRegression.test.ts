/**
 * P2-10（2026-09-25）：`computeSummaryCharBudget` **迁入策略层后的逐值回归锁**。
 *
 * 目的：`summaryTrim.computeSummaryCharBudget` 已改为**委托** `BudgetPolicy` 的
 * `subagent.summary-chars`（见 `.trae/specs/budget-policy-layer.md` G3/D4）——
 * 本文件用**硬编码期望值**（旧公式结果）锁住"迁移零行为变更"，并确认
 * `trimSummaryWithFooter` 的裁剪逻辑未受影响。
 */
import { describe, test, expect } from 'bun:test';
import {
  computeSummaryCharBudget,
  trimSummaryWithFooter,
  SUMMARY_HARD_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  SUMMARY_HEAD_RATIO,
  type SummaryBudgetInput,
} from '../../../src/tools/AgentTool/summaryTrim';
import {
  evaluateSummaryCharBudget,
  SUMMARY_HARD_MAX_CHARS as POLICY_HARD_MAX,
  SUMMARY_MIN_CHARS as POLICY_MIN,
} from '../../../src/core/tokenBudget/BudgetPolicy';

/** [输入, 旧公式期望值]（期望值由迁移前的公式手算，作为回归基准） */
const CASES: Array<[SummaryBudgetInput, number]> = [
  [{ workerCount: 1 }, 2000], // 父上下文未知 ⇒ 退化下限
  [{ parentPromptTokens: 0, contextWindow: 1000, workerCount: 1 }, 2000], // 500×3.5=1750 ⇒ 夹下限
  [{ parentPromptTokens: 0, contextWindow: 10000, workerCount: 1 }, 17500], // 5000×3.5
  [{ parentPromptTokens: 0, contextWindow: 100000, workerCount: 1 }, 24000], // 175000 ⇒ 夹硬顶
  [{ parentPromptTokens: 9000, contextWindow: 10000, workerCount: 1 }, 2000], // 余 1000 ⇒ 1750 ⇒ 下限
  [{ parentPromptTokens: 0, contextWindow: 10000, workerCount: 4 }, 4375], // 1250×3.5
  [
    {
      charsPerToken: 2,
      parentPromptTokens: 0,
      contextWindow: 10000,
      workerCount: 1,
    },
    10000,
  ],
  [
    { parentPromptTokens: Number.NaN, contextWindow: 10000, workerCount: 1 },
    2000,
  ], // 非有限 ⇒ 下限
  [{ parentPromptTokens: 20000, contextWindow: 10000, workerCount: 1 }, 2000], // 占用超窗口 ⇒ 余 0 ⇒ 下限
  [{ parentPromptTokens: 0, contextWindow: 10000, workerCount: 0 }, 2000], // workerCount ≤ 0
];

describe('P2-10 摘要预算逐值回归锁', () => {
  test('委托路径结果 === 旧公式期望值（逐值）', () => {
    for (const [input, expected] of CASES) {
      expect(computeSummaryCharBudget(input)).toBe(expected);
    }
  });

  test('委托路径与策略层直调**完全一致**（单一实现，无第二套公式）', () => {
    for (const [input] of CASES) {
      expect(computeSummaryCharBudget(input)).toBe(
        evaluateSummaryCharBudget(input)
      );
    }
  });

  test('常量与输入类型经 summaryTrim re-export 后取值不变（公共 API 未破）', () => {
    expect(SUMMARY_HARD_MAX_CHARS).toBe(24000);
    expect(SUMMARY_MIN_CHARS).toBe(2000);
    expect(SUMMARY_HEAD_RATIO).toBe(0.75);
    expect(SUMMARY_HARD_MAX_CHARS).toBe(POLICY_HARD_MAX);
    expect(SUMMARY_MIN_CHARS).toBe(POLICY_MIN);
  });
});

describe('P2-10 迁移未影响裁剪逻辑', () => {
  test('trimSummaryWithFooter：超限时 head 75% + tail 25%，省略数正确', () => {
    const text = 'a'.repeat(100);
    const out = trimSummaryWithFooter(text, 50);

    expect(out.truncated).toBe(true);
    expect(out.omittedChars).toBe(50); // 100 - 37(head) - 13(tail)
    expect(out.text.startsWith('a'.repeat(37))).toBe(true);
    expect(out.text.endsWith('a'.repeat(13))).toBe(true);
    expect(out.text).toContain('已省略 50 个字符');
  });

  test('trimSummaryWithFooter：未超限原样返回', () => {
    const out = trimSummaryWithFooter('short', 100);
    expect(out).toEqual({ text: 'short', truncated: false, omittedChars: 0 });
  });
});
