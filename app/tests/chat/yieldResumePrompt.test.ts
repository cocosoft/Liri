/**
 * O8⑤（v7.1）：重放投递的续跑正文必须带**模型可见**标记。
 *
 * 背景：`restored: true` 的语义是"该结算信号来自崩溃后重放，恢复可能此前已发生过"。
 * 原实现只把 `restored` 写进 metadata（`yieldReason`）与日志 ⇒ **模型看不到**，
 * 会把重复恢复当成首次恢复，从而重做已完成的工作（G15 要防的重复副作用）。
 */
import { describe, test, expect } from 'bun:test';
import {
  buildYieldResumePrompt,
  YIELD_RESUME_PROMPT,
  YIELD_SETTLEMENT_RESTORED_REASON,
} from '../../src/chat/yield/YieldSettlementBridge';

describe('buildYieldResumePrompt（O8⑤ / v7.1）', () => {
  test('正常结算/未给出 reason ⇒ 基础文案（无重放标记）', () => {
    expect(buildYieldResumePrompt(undefined)).toBe(YIELD_RESUME_PROMPT);
    expect(buildYieldResumePrompt('subagents_settled')).toBe(
      YIELD_RESUME_PROMPT
    );
    expect(buildYieldResumePrompt('subagents_settled')).not.toContain('重放');
  });

  test('重放投递 ⇒ 正文带可见标记，且仍包含基础指令', () => {
    const text = buildYieldResumePrompt(YIELD_SETTLEMENT_RESTORED_REASON);

    expect(text).toContain('[重放投递]');
    expect(text).toContain('重放');
    // 避免重复劳动的指引必须给到模型
    expect(text).toContain('避免重复劳动');
    // 基础续跑指令不能被吞掉（模型仍需知道该继续干活）
    expect(text).toContain(YIELD_RESUME_PROMPT);
  });

  test('未知 reason ⇒ 退化为基础文案（不误标重放）', () => {
    expect(buildYieldResumePrompt('something_else')).toBe(YIELD_RESUME_PROMPT);
  });
});
