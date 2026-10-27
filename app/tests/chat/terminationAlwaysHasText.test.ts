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
  buildEmptyReplyFallback,
  hasVisibleAssistantText,
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

  it('负向对照：有正文 / 有可见文本块 ⇒ emptyOutputFallback=false', () => {
    expect(
      resolveTerminationOutput(
        base({ reason: 'completed', assistantMessageContent: '正文' })
      ).emptyOutputFallback
    ).toBe(false);
    expect(
      resolveTerminationOutput(
        base({
          reason: 'completed',
          assistantMessageContent: [{ type: 'text', value: '正文' }],
        })
      ).emptyOutputFallback
    ).toBe(false);
    // 代码块同样是用户可见正文
    expect(
      resolveTerminationOutput(
        base({
          reason: 'completed',
          assistantMessageContent: [{ type: 'code', value: 'const a = 1;' }],
        })
      ).emptyOutputFallback
    ).toBe(false);
  });

  it('BUG-E：空数组 / 只含工具块 / 空白文本块 ⇒ 都算"无可见正文"，必须兜底', () => {
    for (const content of [
      [],
      [{ type: 'tool_call', value: '' }],
      [{ type: 'tool_result', value: '{"ok":true}' }],
      [{ type: 'thinking', value: '想了很久' }],
      [{ type: 'text', value: '   ' }],
      [{ type: 'text' }],
      undefined,
    ]) {
      const out = resolveTerminationOutput(
        base({ reason: 'completed', assistantMessageContent: content })
      );
      expect(out.emptyOutputFallback).toBe(true);
      expect(out.suffix.trim().length).toBeGreaterThan(0);
    }
  });

  it('BUG-E：hasVisibleAssistantText 的边界（text/code 非空才算可见）', () => {
    expect(hasVisibleAssistantText(' x ')).toBe(true);
    expect(hasVisibleAssistantText('  ')).toBe(false);
    expect(hasVisibleAssistantText([])).toBe(false);
    expect(hasVisibleAssistantText([{ type: 'text', value: 'x' }])).toBe(true);
    expect(hasVisibleAssistantText([{ type: 'text', value: ' ' }])).toBe(false);
    expect(
      hasVisibleAssistantText([
        { type: 'tool_call', value: '' },
        { type: 'text', value: '结论' },
      ])
    ).toBe(true);
  });

  it('BUG-E 补口：非 ReAct 路径（TAOR）空答复也走同一兜底', () => {
    // 真机复验实测：TAORLoop finalize 不产出消息 ⇒ 末条 assistant 为空 ⇒ contentLength=0
    for (const content of [
      '',
      [],
      [{ type: 'tool_call', value: '' }],
      undefined,
    ]) {
      const fb = buildEmptyReplyFallback(content);
      expect(fb).not.toBeNull();
      expect(fb?.content.trim().length).toBeGreaterThan(0);
      expect(fb?.metadata.emptyOutputFallback).toBe(true);
    }
  });

  it('BUG-E 第二轮复验：只含 <think> 的正文不算可见（真机实测形态）', () => {
    // 14:01Z 实测末条 assistant = '<think>上次调用漏了参数。现在直接写两个文件。</think>'
    const thinkOnly = '<think>上次调用漏了参数。现在直接写两个文件。</think>';
    expect(hasVisibleAssistantText(thinkOnly)).toBe(false);
    expect(
      buildEmptyReplyFallback(thinkOnly)?.metadata.emptyOutputFallback
    ).toBe(true);
    expect(hasVisibleAssistantText([{ type: 'text', value: thinkOnly }])).toBe(
      false
    );
    // 负向对照：think 之外还有结论 ⇒ 算可见
    expect(
      hasVisibleAssistantText(`<think>推理</think>\n已完成，产物在 game/。`)
    ).toBe(true);
    // 未闭合 think（模型常见残渣）⇒ 也不算可见
    expect(hasVisibleAssistantText('<think>想了一半没有闭合')).toBe(false);
  });

  it('BUG-E 补口负向对照：已有可见正文 ⇒ 返回 null（不得追加文案）', () => {
    expect(
      buildEmptyReplyFallback('已完成，产物在 game/index.html')
    ).toBeNull();
    expect(
      buildEmptyReplyFallback([{ type: 'text', value: '结论' }])
    ).toBeNull();
    expect(
      buildEmptyReplyFallback([{ type: 'code', value: 'const a=1' }])
    ).toBeNull();
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
