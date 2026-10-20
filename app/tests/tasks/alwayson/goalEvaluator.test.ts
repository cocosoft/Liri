/**
 * AlwaysOn 目标达成自评 · 纯函数回归（2026-10-20 产品裁定启用）。
 *
 * 重点证伪「把不确定说成达成」：任何非法/缺失/不可解析的输出都必须落到 `unverified`。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildGoalEvaluationPrompt,
  formatGoalAchievementLine,
  parseGoalEvaluation,
  unverifiedGoal,
} from '../../../src/tasks/alwayson/goalEvaluator';

describe('buildGoalEvaluationPrompt', () => {
  const base = {
    goalSummary: '补齐缺失单测',
    planJson: '{"summary":"s"}',
    success: true,
    toolCalls: 3,
    errors: [] as string[],
    output: '已补 2 个用例',
    diffBytes: 120,
  };

  it('含目标/计划/事实证据，并明令禁止调用工具与读文件', () => {
    const prompt = buildGoalEvaluationPrompt(base);
    expect(prompt).toContain('补齐缺失单测');
    expect(prompt).toContain('{"summary":"s"}');
    expect(prompt).toContain('不要调用任何工具');
    expect(prompt).toContain('补丁字节：120');
    // 输出契约必须是单行 JSON 三值
    expect(prompt).toContain('"achieved":"yes|no|unknown"');
  });

  it('无错误 / 空输出 / 未隔离 ⇒ 如实写占位，不编造', () => {
    const prompt = buildGoalEvaluationPrompt({
      ...base,
      errors: [],
      output: '   ',
      diffBytes: undefined,
    });
    expect(prompt).toContain('（无）');
    expect(prompt).toContain('（空）');
    expect(prompt).toContain('补丁字节：未隔离');
  });
});

describe('parseGoalEvaluation（不臆造）', () => {
  it('yes/no/unknown ⇒ achieved/not_achieved/unverified', () => {
    expect(parseGoalEvaluation('{"achieved":"yes","reason":"做了"}')).toEqual({
      verdict: 'achieved',
      reason: '做了',
      source: 'model',
    });
    expect(parseGoalEvaluation('{"achieved":"no","reason":"缺一半"}')).toEqual({
      verdict: 'not_achieved',
      reason: '缺一半',
      source: 'model',
    });
    expect(parseGoalEvaluation('{"achieved":"unknown"}')).toEqual({
      verdict: 'unverified',
      reason: undefined,
      source: 'model',
    });
  });

  it('容忍代码块与前后说明、大小写与空白', () => {
    const text =
      '结论如下：\n```json\n{ "achieved" : " YES " , "reason" : " ok " }\n```\n完';
    expect(parseGoalEvaluation(text)).toEqual({
      verdict: 'achieved',
      reason: 'ok',
      source: 'model',
    });
  });

  it('无 JSON / 坏 JSON / 非法取值 / 缺字段 ⇒ 一律 unverified', () => {
    expect(parseGoalEvaluation('全部完成！').source).toBe('parse:no-json');
    expect(parseGoalEvaluation('{"achieved":}').source).toBe(
      'parse:invalid-json'
    );
    expect(parseGoalEvaluation('{"achieved":"maybe"}').source).toBe(
      'parse:invalid-verdict'
    );
    expect(parseGoalEvaluation('{"reason":"没给结论"}').source).toBe(
      'parse:invalid-verdict'
    );
    for (const text of [
      '全部完成！',
      '{"achieved":}',
      '{"achieved":"maybe"}',
      '{"reason":"没给结论"}',
    ]) {
      expect(parseGoalEvaluation(text).verdict).toBe('unverified');
    }
  });

  it('理由超长 ⇒ 截断到 200 字（不改写内容）', () => {
    const long = 'x'.repeat(500);
    const result = parseGoalEvaluation(
      JSON.stringify({ achieved: 'no', reason: long })
    );
    expect(result.reason!.length).toBe(200);
  });
});

describe('formatGoalAchievementLine / unverifiedGoal', () => {
  it('缺省 ⇒ 保持 v2 的 unverified 文案', () => {
    expect(formatGoalAchievementLine(undefined)).toContain(
      'unverified（仅记录本轮执行结果，未做模型自评）'
    );
  });

  it('achieved / not_achieved 带理由；非 model 来源追加 source', () => {
    expect(
      formatGoalAchievementLine({ verdict: 'achieved', reason: '完成' })
    ).toBe('- **Goal Achievement**: achieved（完成）');
    expect(
      formatGoalAchievementLine({
        verdict: 'unverified',
        reason: '预算锁定',
        source: 'skipped:budget',
      })
    ).toBe(
      '- **Goal Achievement**: unverified（预算锁定；来源 skipped:budget）'
    );
  });

  it('unverifiedGoal 统一构造 source（可带/不带理由）', () => {
    expect(unverifiedGoal('skipped:budget')).toEqual({
      verdict: 'unverified',
      source: 'skipped:budget',
    });
    expect(unverifiedGoal('error:x', 'boom')).toEqual({
      verdict: 'unverified',
      source: 'error:x',
      reason: 'boom',
    });
  });
});
