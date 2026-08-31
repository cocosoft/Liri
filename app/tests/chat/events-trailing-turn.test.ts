/**
 * M2-T2.1 — events 尾部重建核心识别逻辑单测
 *
 * 对齐 openworker `_unanswered_trailing_tool_calls` 语义锁定：
 *   ① 已答工具（tool/result 或 tool/canceled 终态）不重复执行
 *   ② 从尾部向前扫 assistant/tool_call，遇 user/message 停止（新对话边界）
 *   ③ 尾部无未完成工具 → 空 pending（不触发重建）
 *   ④ 同一 turn 内多个未答工具全部收集
 */

import { describe, it, expect } from 'bun:test';
import { extractPendingToolCallsFromEvents } from '../../src/chat/utils/pendingToolCalls.js';
import type { LiriEvent } from '../../src/chat/types/events.js';

const ev = (
  seq: number,
  type: LiriEvent['type'],
  data: Record<string, unknown>
): LiriEvent =>
  ({
    seq,
    type,
    data,
    schemaVersion: 1,
    time: Date.now(),
    sessionId: 'sess-test',
  }) as LiriEvent;

describe('extractPendingToolCallsFromEvents（M2-T2.1）', () => {
  it('① 已答工具跳过：尾部 tool_call 已有 result → 不重复执行', () => {
    const events = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'tc-answered',
        name: 'bash',
        args: { command: 'ls' },
      }),
      ev(2, 'tool/result', { toolCallId: 'tc-answered', callSeq: 1, result: 'ok' }),
    ];
    const { pending, answered } = extractPendingToolCallsFromEvents(events);
    expect(answered.has('tc-answered')).toBe(true);
    expect(pending).toEqual([]);
  });

  it('② 未答工具保留：tail 有 pendingApproval 工具无 result → 收集为 pending', () => {
    const events = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'tc-pending',
        name: 'ask_user_question',
        args: { question: '请确认' },
        messageId: 'msg-a1',
      }),
    ];
    const { pending } = extractPendingToolCallsFromEvents(events);
    expect(pending).toHaveLength(1);
    expect(pending[0].toolCallId).toBe('tc-pending');
    expect(pending[0].name).toBe('ask_user_question');
    expect(pending[0].messageId).toBe('msg-a1');
  });

  it('③ user/message 边界：新对话开始后尾部 tool_call 不重建', () => {
    const events = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'tc-old',
        name: 'bash',
        args: { command: 'old' },
      }),
      ev(2, 'user/message', { content: '新对话' }),
      ev(3, 'assistant/text', { content: '你好' }),
    ];
    const { pending } = extractPendingToolCallsFromEvents(events);
    // 尾部（user 之后）无未答 tool_call → 空
    expect(pending).toEqual([]);
  });

  it('④ 混合：已答跳过 + 未答保留（同一 turn 内多工具）', () => {
    const events = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'tc-1',
        name: 'grep',
        args: { pattern: 'a' },
      }),
      ev(2, 'tool/result', { toolCallId: 'tc-1', callSeq: 1, result: 'hit' }),
      ev(3, 'assistant/tool_call', {
        toolCallId: 'tc-2',
        name: 'glob',
        args: { pattern: '**/*.ts' },
      }),
      ev(4, 'assistant/tool_call', {
        toolCallId: 'tc-3',
        name: 'read',
        args: { path: 'a.ts' },
      }),
    ];
    const { pending, answered } = extractPendingToolCallsFromEvents(events);
    expect(answered.has('tc-1')).toBe(true);
    const ids = pending.map((p) => p.toolCallId);
    expect(ids).toContain('tc-2');
    expect(ids).toContain('tc-3');
    expect(ids).not.toContain('tc-1');
  });

  it('⑤ canceled 终态同样视为已答（不重复执行）', () => {
    const events = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'tc-canceled',
        name: 'bash',
        args: {},
      }),
      ev(2, 'tool/canceled', { toolCallId: 'tc-canceled', callSeq: 1 }),
    ];
    const { pending } = extractPendingToolCallsFromEvents(events);
    expect(pending).toEqual([]);
  });

  it('⑥ 空 events → 空 pending/answered', () => {
    const { pending, answered } = extractPendingToolCallsFromEvents([]);
    expect(pending).toEqual([]);
    expect(answered.size).toBe(0);
  });
});
