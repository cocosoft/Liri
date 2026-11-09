// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-09（真机 SMOKE，deepseek-v4-flash 非流式工具轮）：
 * 非流式响应没有 thinking chunk，思考只在响应体 `reasoning`（`reasoning_content`）里。
 * 不读它 ⇒ 「只思考、正文为空」被判成"空回复"（真机 `kind="empty" textPreview=""`），
 * 续接指令让模型"再输出一次"而不是"别只想着，给结论"。
 */
import { describe, expect, it } from 'bun:test';

import { attributeReasonRound } from '../../src/chat/agentReasonAttribution.js';

const NO_CHUNKS = { text: 0, thinking: 0 };

describe('attributeReasonRound：reasoning 归因（非流式补思考标记）', () => {
  it('★ 响应体带 reasoning ⇒ hadReasoning=true', () => {
    expect(
      attributeReasonRound(
        { content: '', reasoning: '先确认文件是否存在' },
        NO_CHUNKS
      ).hadReasoning
    ).toBe(true);
  });

  it('reasoning 为 null / 空串 / 纯空白 / 缺失 ⇒ false（不臆造）', () => {
    for (const response of [
      { content: 'ok', reasoning: null },
      { content: 'ok', reasoning: '' },
      { content: '', reasoning: '   ' },
      { content: 'ok' },
    ]) {
      expect(attributeReasonRound(response, NO_CHUNKS).hadReasoning).toBe(
        false
      );
    }
  });

  it('非字符串 reasoning（协议变体）⇒ false，不抛', () => {
    expect(
      attributeReasonRound({ reasoning: { text: 'x' } }, NO_CHUNKS).hadReasoning
    ).toBe(false);
  });

  it('零回归：分片计数归因不受影响', () => {
    const r = attributeReasonRound({}, { text: 3, thinking: 1 });
    expect(r.thinkingRatio).toBe(0.25);
    expect(r.partialToolCalls).toEqual([]);
  });
});
