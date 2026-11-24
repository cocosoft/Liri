// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-24（会话 `session_mwurduuh1b0b38db30`）：审批重放结果的**统计去重**回归锁。
 *
 * 真机：264 次工具调用 / 265 条 `tool/result` —— `call_02_…` 先后落了
 * ① `awaiting_approval` 占位（seq=113）与 ② 批准后真实结果（seq=121）。
 * 两条结果**刻意保留**作为审计轨迹（发送模型前由 `dedupeToolResults` 剔除），
 * 但统计口径必须按**调用**去重，否则出现"结果数 > 调用数"的假异常。
 */
import { describe, expect, it } from 'bun:test';
import { deriveSessionStats } from '@modules/session/storage/EventMessageDeriver';
import type { LiriEvent } from '@modules/session/types/events';

function ev(
  seq: number,
  type: LiriEvent['type'],
  data: Record<string, unknown>
): LiriEvent {
  return {
    type: type as never,
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId: 's1',
    data: data as never,
  };
}

describe('deriveSessionStats：审批重放结果去重', () => {
  it('同一 toolCallId 的占位 + 真实结果 ⇒ 计 1 次调用，另记 1 条重放', () => {
    const events: LiriEvent[] = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'c1',
        name: 'bash',
        args: {},
      }),
      ev(2, 'tool/result', {
        callSeq: 1,
        toolCallId: 'c1',
        result: '{"status":"awaiting_approval","pendingApproval":true}',
      }),
      ev(3, 'tool/result', {
        callSeq: 1,
        toolCallId: 'c1',
        result: 'done',
      }),
    ];
    const stats = deriveSessionStats(events);
    expect(stats.toolCallCount).toBe(1);
    expect(stats.toolResultCount).toBe(1);
    expect(stats.toolResultReplayCount).toBe(1);
    expect(stats.toolOrphanCount).toBe(0);
  });

  it('无重复 ⇒ 结果数 = 调用数，replay = 0', () => {
    const events: LiriEvent[] = [
      ev(1, 'assistant/tool_call', {
        toolCallId: 'c1',
        name: 'grep',
        args: {},
      }),
      ev(2, 'tool/result', { callSeq: 1, toolCallId: 'c1', result: 'ok' }),
      ev(3, 'assistant/tool_call', {
        toolCallId: 'c2',
        name: 'grep',
        args: {},
      }),
      ev(4, 'tool/result', { callSeq: 3, toolCallId: 'c2', result: 'ok2' }),
    ];
    const stats = deriveSessionStats(events);
    expect(stats.toolCallCount).toBe(2);
    expect(stats.toolResultCount).toBe(2);
    expect(stats.toolResultReplayCount).toBe(0);
  });

  it('缺少 toolCallId 的结果仍如实计数（不静默丢弃，也不参与去重）', () => {
    const events: LiriEvent[] = [
      ev(1, 'tool/result', { callSeq: -1, result: 'orphan-result' }),
    ];
    const stats = deriveSessionStats(events);
    expect(stats.toolResultCount).toBe(1);
    expect(stats.toolResultReplayCount).toBe(0);
  });
});
