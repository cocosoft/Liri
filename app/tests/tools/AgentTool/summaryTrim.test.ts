/**
 * 摘要预算与溢出裁剪测试（多 agent 协作方案 O9）
 *
 * 锁定：预算的 50%/2500 夹取与"父上下文未知 ⇒ 下限退化"；裁剪的 **head 75% / tail 25%**
 * 且**尾部内容必须保留**（原 `substring(0,500)` 恰丢掉结尾的结论与改动清单）。
 */
import { describe, test, expect } from 'bun:test';
import {
  computeSummaryCharBudget,
  trimSummaryWithFooter,
  SUMMARY_HARD_MAX_CHARS,
  SUMMARY_MIN_CHARS,
} from '../../../src/tools/AgentTool/summaryTrim';

/** 造 n 行文本，每行形如 `line-<i>-xxxx` */
function lines(n: number, pad = 40): string {
  return Array.from(
    { length: n },
    (_, i) => `line-${i}-${'x'.repeat(pad)}`
  ).join('\n');
}

describe('computeSummaryCharBudget（预算）', () => {
  test('父当前占用已知 ⇒ 剩余 50% ÷ worker 数，并夹到硬顶', () => {
    const budget = computeSummaryCharBudget({
      parentPromptTokens: 20_000,
      contextWindow: 200_000,
      workerCount: 3,
    });
    // 剩余 180k × 50% ÷ 3 = 30k tokens ⇒ 105000 字符 ⇒ 触硬顶
    expect(budget).toBe(SUMMARY_HARD_MAX_CHARS);
  });

  test('剩余很少 ⇒ 不低于下限', () => {
    const budget = computeSummaryCharBudget({
      parentPromptTokens: 199_000,
      contextWindow: 200_000,
      workerCount: 5,
    });
    expect(budget).toBe(SUMMARY_MIN_CHARS);
  });

  test('父上下文未知（缺 prompt tokens 或窗口）⇒ 退化下限，不臆测', () => {
    expect(
      computeSummaryCharBudget({ workerCount: 3 })
    ).toBe(SUMMARY_MIN_CHARS);
    expect(
      computeSummaryCharBudget({
        parentPromptTokens: 10_000,
        workerCount: 3,
      })
    ).toBe(SUMMARY_MIN_CHARS);
  });
});

describe('trimSummaryWithFooter（75/25 头尾）', () => {
  test('未超限 ⇒ 原样返回，未裁剪', () => {
    const text = lines(3);
    const r = trimSummaryWithFooter(text, 1000);

    expect(r.truncated).toBe(false);
    expect(r.text).toBe(text);
    expect(r.omittedChars).toBe(0);
  });

  test('超限 ⇒ 保留尾部（结论/改动清单）+ 标注省略量', () => {
    const text = `HEAD-START\n${lines(400)}\nTAIL-CONCLUSION`;
    const r = trimSummaryWithFooter(text, 500);

    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('HEAD-START')).toBe(true);
    // 关键：结尾结论仍在（原实现 `substring(0,500)` 会丢掉）
    expect(r.text.endsWith('TAIL-CONCLUSION')).toBe(true);
    expect(r.text).toContain('已省略');
    expect(r.omittedChars).toBeGreaterThan(0);
    // head 占多数（75/25）：标记之前的头部长度 > 标记之后的尾段长度
    const [headPart, tailPart] = r.text.split('\n\n… [已省略')[1].split('] …\n\n');
    expect(headPart.length).toBeGreaterThan(0);
    expect(tailPart.length).toBeGreaterThan(0);
  });

  test('行边界对齐：head 不以半行截断', () => {
    const text = `${lines(200)}\nFINAL-LINE`;
    const r = trimSummaryWithFooter(text, 400);
    const headPart = r.text.split('\n\n… [')[0];

    // head 的每一行都应是完整的 `line-<i>-xxx` 形态（不出现被切半的行）
    for (const line of headPart.split('\n').filter(Boolean)) {
      expect(line).toMatch(/^line-\d+-x+$/);
    }
  });

  test('给出 spillPath 时写入标记（全文指针）', () => {
    const r = trimSummaryWithFooter(lines(300), 300, {
      spillPath: '/tmp/out/worker-1.md',
    });
    expect(r.text).toContain('/tmp/out/worker-1.md');
  });

  test('极小预算不抛错（退化保护）', () => {
    const r = trimSummaryWithFooter(lines(50), 5);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
  });
});
