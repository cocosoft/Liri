/**
 * F3（2026-10-27）：**终止必须有正文**。
 *
 * 来源：Liri 报告 R6 / P0-4 —— 实测会话 `session_mvoqs1ho875ea6b95e` 出现
 * 「跑了几千次工具调用、`assistant/text` 长度 0」，以及 4 个 `canceled` 轮次无任何可见文本。
 *
 * 本用例锁定不变量：**正文为空时，任何非 completed 的终止原因都必须给出非空收尾文案**
 * （由 `resolveTerminationOutput` 的统一兜底保证），避免"静默空白"。
 * 负向对照：正常完成且已有正文时**不得**强行追加提示。
 */
import { describe, expect, it } from 'bun:test';

import {
  isEmptyOutputFallbackMessage,
  resolveTerminationOutput,
  type TerminationOutputInput,
} from '../../src/chat/terminationOutput.js';

const base = (
  overrides: Partial<TerminationOutputInput>
): TerminationOutputInput => ({
  reason: 'completed',
  iteration: 1,
  maxIterations: 50,
  isLongTaskSignal: false,
  droppedToolCallsAtStop: 0,
  maxTotalDurationMs: 60_000,
  assistantMessageContent: '',
  ...overrides,
});

describe('F3：终止必须有正文', () => {
  it('circuit_breaker 且 lastError 为空、正文为空 ⇒ 仍给兜底文案', () => {
    const out = resolveTerminationOutput(base({ reason: 'circuit_breaker' }));
    expect(out.suffix.trim().length).toBeGreaterThan(0);
    expect(out.finishReason).toBe('circuit_breaker');
  });

  it('max_turns（未真达上限）且正文为空 ⇒ 仍给兜底文案', () => {
    const out = resolveTerminationOutput(
      base({ reason: 'max_turns', iteration: 3, maxIterations: 50 })
    );
    expect(out.suffix.trim().length).toBeGreaterThan(0);
  });

  it('用户中止 / 系统中止 且正文为空 ⇒ 各有明确文案', () => {
    expect(
      resolveTerminationOutput(base({ reason: 'aborted' })).suffix.trim().length
    ).toBeGreaterThan(0);
    expect(
      resolveTerminationOutput(base({ reason: 'system_aborted' })).suffix.trim()
        .length
    ).toBeGreaterThan(0);
  });

  it('负向对照：completed 且已有正文 ⇒ 不追加任何提示', () => {
    const out = resolveTerminationOutput(
      base({ reason: 'completed', assistantMessageContent: '已完成分析。' })
    );
    expect(out.suffix).toBe('');
  });
});

/**
 * BUG-A（2026-10-27，真机长程任务）：兜底文案必须**结构化**，供下游判定
 * （实测：兜底文案被当成 PDCA 任务描述，建出无关需求并灌入 89 条无关消息）。
 */
describe('BUG-A：空输出兜底的结构化标记', () => {
  it('无可见正文且走统一兜底 ⇒ emptyOutputFallback=true', () => {
    const out = resolveTerminationOutput(
      base({ reason: 'completed', assistantMessageContent: '' })
    );
    expect(out.emptyOutputFallback).toBe(true);
    expect(out.suffix.trim().length).toBeGreaterThan(0);
  });

  it('负向对照：有正文 / 有结构化块 ⇒ emptyOutputFallback=false', () => {
    expect(
      resolveTerminationOutput(
        base({ reason: 'completed', assistantMessageContent: '正文' })
      ).emptyOutputFallback
    ).toBe(false);
    expect(
      resolveTerminationOutput(
        base({
          reason: 'completed',
          assistantMessageContent: [{ type: 'text' }],
        })
      ).emptyOutputFallback
    ).toBe(false);
  });

  it('标记读取只认 metadata（禁止比对文案 —— CS02）', () => {
    expect(
      isEmptyOutputFallbackMessage({
        metadata: { emptyOutputFallback: true },
      })
    ).toBe(true);
    // 文案里含「未生成回复」但没有标记 ⇒ 不是兜底消息
    expect(
      isEmptyOutputFallbackMessage({
        content: '⚠️ 本次未能生成回复（模型本轮未产出可见内容）',
      })
    ).toBe(false);
    expect(isEmptyOutputFallbackMessage(undefined)).toBe(false);
  });
});
