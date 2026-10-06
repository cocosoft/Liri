/**
 * U4 会话级质量摘要（D6 取数口径）纯函数单测。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D6 + §5（用例 8 的取数侧）。
 */
import { describe, expect, it } from 'bun:test';
import type { LiriEvent } from '../../src/session/types/events';
import {
  EMPTY_TURN_QUALITY_SUMMARY,
  summarizeTurnQuality,
} from '../../src/evals/online/summarizeTurnQuality';
import {
  HIGH_VALUE_SCORE_THRESHOLD,
  SUSPICIOUS_SCORE_THRESHOLD,
} from '../../src/evals/online/weights';

function qualityEvent(
  seq: number,
  turnNumber: number,
  score: number
): LiriEvent {
  return {
    type: 'turn/quality',
    seq,
    time: 1_700_000_000_000 + seq,
    sessionId: 's1',
    data: { turnNumber, score },
  } as unknown as LiriEvent;
}

describe('U4 summarizeTurnQuality：摘要口径', () => {
  it('无 turn/quality 事件 ⇒ 空摘要（不伪造分数）', () => {
    const other = {
      type: 'turn/end',
      seq: 1,
      time: 1,
      sessionId: 's1',
      data: { turn: 1 },
    } as unknown as LiriEvent;
    expect(summarizeTurnQuality([])).toEqual(EMPTY_TURN_QUALITY_SUMMARY);
    expect(summarizeTurnQuality([other])).toEqual(EMPTY_TURN_QUALITY_SUMMARY);
  });

  it('均分 + 高/低价值分类（阈值边界：高价值含等号，低价值不含）', () => {
    const events = [
      qualityEvent(1, 1, HIGH_VALUE_SCORE_THRESHOLD), // 高价值（≥）
      qualityEvent(2, 2, 0.6), // 中间：既不高中也不低
      qualityEvent(3, 3, SUSPICIOUS_SCORE_THRESHOLD - 0.01), // 低价值（<）
    ];
    const s = summarizeTurnQuality(events);
    expect(s.total).toBe(3);
    expect(s.highValueTurns).toEqual([1]);
    expect(s.lowValueTurns).toEqual([3]);
    expect(s.avgScore).toBeCloseTo(
      (HIGH_VALUE_SCORE_THRESHOLD + 0.6 + SUSPICIOUS_SCORE_THRESHOLD - 0.01) /
        3,
      10
    );
  });

  it('等于可疑阈值 ⇒ **不算**低价值（边界为"小于"，与可疑判定同口径）', () => {
    const s = summarizeTurnQuality([
      qualityEvent(1, 1, SUSPICIOUS_SCORE_THRESHOLD),
    ]);
    expect(s.total).toBe(1);
    expect(s.lowValueTurns).toEqual([]);
  });

  it('畸形事件跳过且**不计入 total**（不把脏数据算成低分轮）', () => {
    const bad1 = {
      type: 'turn/quality',
      seq: 5,
      time: 1,
      sessionId: 's1',
      data: { turnNumber: 9, score: 'high' },
    } as unknown as LiriEvent;
    const bad2 = {
      type: 'turn/quality',
      seq: 6,
      time: 1,
      sessionId: 's1',
      data: { score: 0.2 },
    } as unknown as LiriEvent;
    const s = summarizeTurnQuality([qualityEvent(1, 1, 0.9), bad1, bad2]);
    expect(s.total).toBe(1);
    expect(s.avgScore).toBeCloseTo(0.9, 10);
    expect(s.lowValueTurns).toEqual([]);
  });

  it('乱序输入按 seq 排序 ⇒ 轮号数组升序', () => {
    const s = summarizeTurnQuality([
      qualityEvent(3, 3, 0.1),
      qualityEvent(1, 1, 0.9),
      qualityEvent(2, 2, 0.95),
    ]);
    expect(s.highValueTurns).toEqual([1, 2]);
    expect(s.lowValueTurns).toEqual([3]);
  });
});
