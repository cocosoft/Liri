/**
 * IngestFunnel shadow 台账汇总（`ingestFunnelDigest.ts`）单测
 *
 * 覆盖：损坏行只计数、窗口过滤、分组排序与 top 截断、drop 原因仅统计 drop。
 */
import { describe, expect, it } from 'bun:test';

import { summarizeIngestFunnelShadowText } from '../../../packages/channels/src/channels/routing/ingestFunnelDigest';

const DAY = 24 * 60 * 60 * 1000;

function line(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    at: 1_000,
    channelId: 'dingtalk',
    conversationId: 'conv-1',
    senderIdHash: 'aaaaaaaa',
    eventType: 'bot.message',
    decision: 'pass',
    reason: null,
    ...over,
  });
}

describe('summarizeIngestFunnelShadowText', () => {
  it('空文本 ⇒ 全零报告', () => {
    const report = summarizeIngestFunnelShadowText('');
    expect(report.total).toBe(0);
    expect(report.windowTotal).toBe(0);
    expect(report.byChannel).toEqual([]);
  });

  it('损坏行只计数，不影响其余样本', () => {
    const report = summarizeIngestFunnelShadowText(
      [line(), 'not-json', '{"at":1}', line({ at: 2_000 })].join('\n')
    );
    expect(report.total).toBe(2);
    expect(report.skipped).toBe(2);
  });

  it('分组按次数降序；同数按最近出现降序', () => {
    const text = [
      line({ conversationId: 'conv-a', at: 1 }),
      line({ conversationId: 'conv-a', at: 5 }),
      line({ conversationId: 'conv-b', at: 9 }),
    ].join('\n');
    const report = summarizeIngestFunnelShadowText(text);
    expect(report.byConversation.map((r) => r.key)).toEqual([
      'conv-a',
      'conv-b',
    ]);
    expect(report.byConversation[0]).toEqual({
      key: 'conv-a',
      count: 2,
      lastSeen: 5,
    });
  });

  it('top 截断生效', () => {
    const text = [
      line({ channelId: 'a' }),
      line({ channelId: 'b' }),
      line({ channelId: 'c' }),
    ].join('\n');
    expect(
      summarizeIngestFunnelShadowText(text, { top: 2 }).byChannel
    ).toHaveLength(2);
  });

  it('sinceDays 只保留窗口内记录', () => {
    const now = 10 * DAY;
    const text = [
      line({ at: now - 1 * DAY }),
      line({ at: now - 10 * DAY }),
    ].join('\n');
    const report = summarizeIngestFunnelShadowText(text, {
      sinceDays: 7,
      now,
    });
    expect(report.total).toBe(2);
    expect(report.windowTotal).toBe(1);
  });

  it('dropReasons 只统计 drop（pass 的 null reason 不计入）', () => {
    const text = [
      line(),
      line({ decision: 'drop', reason: 'sender_not_allowed' }),
      line({ decision: 'drop', reason: 'sender_not_allowed' }),
      line({ decision: 'drop', reason: 'conversation_not_allowed' }),
    ].join('\n');
    const report = summarizeIngestFunnelShadowText(text);
    expect(report.byDecision.map((r) => [r.key, r.count])).toEqual([
      ['drop', 3],
      ['pass', 1],
    ]);
    expect(report.dropReasons.map((r) => [r.key, r.count])).toEqual([
      ['sender_not_allowed', 2],
      ['conversation_not_allowed', 1],
    ]);
  });
});
