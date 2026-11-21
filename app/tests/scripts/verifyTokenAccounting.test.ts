// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Token 会计一致性复验脚本的**断言口径**回归锁（方案 §5 P4）。
 *
 * 只测纯分析函数 `analyzeTokenAccounting`：日志采样/文件轮转不属于本用例。
 * 每个用例只放开一个缺陷，确认对应检查项确实变红（避免"脚本恒绿"的假门禁）。
 */
import { describe, expect, it } from 'bun:test';
import {
  analyzeTokenAccounting,
  parseTokenLog,
  type TokenLogRecord,
} from '../../scripts/verify-token-accounting';

const at = Date.parse('2026-11-21T10:00:00Z');
const rec = (
  message: string,
  meta: Record<string, unknown>
): TokenLogRecord => ({ ts: at, message, meta });

const decision = (extra: Record<string, unknown> = {}) =>
  rec('compaction:决策', {
    decision: 'trigger',
    rawInputTokens: 100_000,
    calibratedTotal: 110_000,
    ratio: 0.55,
    maxTokens: 200_000,
    ...extra,
  });

const applied = (before: number, after: number, saving: number) =>
  rec('compaction:applied', {
    tier: 2,
    beforeTokens: before,
    afterTokens: after,
    savingPercent: saving,
  });

describe('analyzeTokenAccounting：四类断言', () => {
  it('正常样本 ⇒ pass（含正节省与变小）', () => {
    const report = analyzeTokenAccounting([
      decision(),
      applied(100_000, 60_000, 40),
    ]);
    expect(report.verdict).toBe('pass');
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.samples.decisions).toBe(1);
    expect(report.samples.applied).toBe(1);
  });

  it('savingPercent 与前后 raw 不同源 ⇒ fail（applied_consistency）', () => {
    const report = analyzeTokenAccounting([
      decision(),
      applied(100_000, 60_000, 80),
    ]);
    expect(report.verdict).toBe('fail');
    expect(report.checks.find((c) => c.id === 'applied_consistency')?.ok).toBe(
      false
    );
  });

  it('变大却报正节省 ⇒ fail（不得把 grew 当节省）', () => {
    const report = analyzeTokenAccounting([
      decision(),
      applied(50_000, 80_000, 10),
    ]);
    expect(report.verdict).toBe('fail');
  });

  it('raw 差异未标 estimateLowerBound ⇒ fail（raw_three_way）', () => {
    const report = analyzeTokenAccounting([
      decision(),
      applied(100_000, 60_000, 40),
      rec('compaction:token_estimate_mismatch', {
        decisionRawInputTokens: 100_000,
        measuredRawInputTokens: 130_000,
        estimateLowerBound: false,
      }),
    ]);
    expect(report.verdict).toBe('fail');
    expect(report.checks.find((c) => c.id === 'raw_three_way')?.ok).toBe(false);
  });

  it('raw 差异带 estimateLowerBound=true ⇒ 属已知解释，不判失败', () => {
    const report = analyzeTokenAccounting([
      decision(),
      applied(100_000, 60_000, 40),
      rec('compaction:token_estimate_mismatch', {
        decisionRawInputTokens: 100_000,
        measuredRawInputTokens: 130_000,
        estimateLowerBound: true,
      }),
    ]);
    expect(report.verdict).toBe('pass');
  });

  it('已删除的 snapshot 字段回流 ⇒ fail（no_snapshot）', () => {
    const report = analyzeTokenAccounting([
      rec('compaction:决策', {
        rawInputTokens: 1,
        calibratedTotal: 1,
        ratio: 0.1,
        maxTokens: 100,
        snapshot: { tokens: 1 },
      }),
      applied(100_000, 60_000, 40),
    ]);
    expect(report.verdict).toBe('fail');
    expect(report.checks.find((c) => c.id === 'no_snapshot')?.ok).toBe(false);
  });

  it('样本不足（无 applied）⇒ insufficient，不得当通过', () => {
    const report = analyzeTokenAccounting([decision()]);
    expect(report.verdict).toBe('insufficient');
  });

  it('旧格式决策（无 rawInputTokens/calibratedTotal）⇒ 跳过，不判违规', () => {
    const report = analyzeTokenAccounting([
      rec('compaction:决策', { decision: 'skip', ratio: 0.4 }),
      decision(),
      applied(100_000, 60_000, 40),
    ]);
    expect(report.verdict).toBe('pass');
    expect(
      report.checks.find((c) => c.id === 'decision_fields')?.detail
    ).toContain('旧格式跳过 1 条');
  });
});

describe('parseTokenLog：完整 meta（不截断）', () => {
  it('解析出 compaction:决策 的完整数值字段', () => {
    const line = JSON.stringify({
      timestamp: '2026-11-21T10:00:00.000Z',
      level: 'info',
      module: 'context:compaction',
      message: 'compaction:决策',
      meta: {
        decision: 'trigger',
        rawInputTokens: 123,
        calibratedTotal: 456,
        ratio: 0.5,
        maxTokens: 1000,
      },
    });
    const [entry] = parseTokenLog(line);
    expect(entry?.message).toBe('compaction:决策');
    expect(entry?.meta['rawInputTokens']).toBe(123);
  });

  it('非日志行 ⇒ 跳过', () => {
    expect(parseTokenLog('  at foo.ts:1\n')).toHaveLength(0);
  });
});
