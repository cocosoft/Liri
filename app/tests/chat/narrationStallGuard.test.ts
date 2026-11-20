/**
 * 「纯叙事空转」判定单测（2026-11-20）
 *
 * 判据事实源：`app/src/chat/manager/narrationStallGuard.ts`（纯函数）。
 * 关键语义：**系统续跑注入不打断**（它把同一条空转切成多段），其余一律打断。
 */
import { describe, expect, test } from 'bun:test';
import {
  NARRATION_STALL_LENGTH,
  countTrailingNarrationRun,
  isNarrationStalled,
} from '../../src/chat/manager/narrationStallGuard';

const narration = (): { role: string; metadata: Record<string, unknown> } => ({
  role: 'assistant',
  metadata: {},
});
const toolRound = (): { role: string; metadata: Record<string, unknown> } => ({
  role: 'assistant',
  metadata: { tool_calls: [{ id: 'c1' }] },
});
const toolResult = (): { role: string; metadata: Record<string, unknown> } => ({
  role: 'tool',
  metadata: { toolCallId: 'c1' },
});
const autoResume = (): { role: string; metadata: Record<string, unknown> } => ({
  role: 'user',
  metadata: { systemResume: true, idleContinuation: true },
});
const human = (): { role: string; metadata: Record<string, unknown> } => ({
  role: 'user',
  metadata: {},
});

describe('countTrailingNarrationRun（尾部连续纯叙事）', () => {
  test('工具轮之后没有叙述 ⇒ 0', () => {
    expect(
      countTrailingNarrationRun([human(), toolRound(), toolResult()])
    ).toBe(0);
  });

  test('2 条叙述（常态：先说再做）⇒ 2，未达阈值', () => {
    const messages = [human(), narration(), narration()];
    expect(countTrailingNarrationRun(messages)).toBe(2);
    expect(isNarrationStalled(messages)).toBe(false);
  });

  test('系统续跑注入**不打断**计数（同一条空转被切成多段）', () => {
    const messages = [
      human(),
      narration(),
      narration(),
      autoResume(),
      narration(),
      autoResume(),
      narration(),
    ];
    expect(countTrailingNarrationRun(messages)).toBe(4);
  });

  test('人工 user 消息打断计数', () => {
    expect(
      countTrailingNarrationRun([
        narration(),
        narration(),
        human(),
        narration(),
      ])
    ).toBe(1);
  });

  test('tool 结果与带 tool_calls 的 assistant 都打断', () => {
    expect(countTrailingNarrationRun([narration(), toolRound()])).toBe(0);
    expect(countTrailingNarrationRun([narration(), toolResult()])).toBe(0);
  });

  test('达到阈值即判空转（默认 6）', () => {
    const five = [human(), ...Array.from({ length: 5 }, narration)];
    const six = [human(), ...Array.from({ length: 6 }, narration)];
    expect(NARRATION_STALL_LENGTH).toBe(6);
    expect(isNarrationStalled(five)).toBe(false);
    expect(isNarrationStalled(six)).toBe(true);
  });

  test('空消息 / 只有系统续跑 ⇒ 0（不臆造）', () => {
    expect(countTrailingNarrationRun([])).toBe(0);
    expect(countTrailingNarrationRun([autoResume()])).toBe(0);
  });
});
