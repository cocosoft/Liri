/**
 * 只读时间旅行切片（演进方案 W5）· 纯函数回归
 *
 * 锁住三条：
 *  ① `untilSeq` 缺省 ⇒ 全量（等价现状），且**不修改入参数组**；
 *  ② `untilSeq` 生效 ⇒ 只保留 `seq <= untilSeq`，并在确实存在更晚事件时标记 `isHistoricalSlice`；
 *  ③ 空事件 ⇒ 空投影（不臆造消息）。
 *
 * 只读语义由实现保证（不写事件、不动 store），此处只锁切片与事实标记。
 */
import { describe, expect, it } from 'bun:test';

import {
  computeIsHistoricalSlice,
  replayTimelineUntil,
  sliceEventsUntil,
} from '../../src/session/timeline/timelineSlice.js';
import type { LiriEvent } from '../../src/session/types/events.js';

function makeEvents(): LiriEvent[] {
  return [
    { type: 'user/message', seq: 1, time: 1, sessionId: 's1' },
    { type: 'assistant/message', seq: 2, time: 2, sessionId: 's1' },
    { type: 'user/message', seq: 5, time: 3, sessionId: 's1' },
  ] as unknown as LiriEvent[];
}

describe('sliceEventsUntil：按 seq 截止', () => {
  it('不传 untilSeq ⇒ 全量且非历史切片，入参数组不被修改', () => {
    const events = makeEvents();
    const before = [...events];
    const slice = sliceEventsUntil(events);
    expect(slice.events).toHaveLength(3);
    expect(slice.isHistoricalSlice).toBe(false);
    expect(events).toEqual(before);
    expect(slice.events).not.toBe(events);
  });

  it('untilSeq=2 ⇒ 只保留 seq<=2，且标记为历史切片', () => {
    const slice = sliceEventsUntil(makeEvents(), 2);
    expect(slice.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(slice.isHistoricalSlice).toBe(true);
  });

  it('untilSeq 覆盖全部 ⇒ 非历史切片（不误报）', () => {
    const slice = sliceEventsUntil(makeEvents(), 99);
    expect(slice.events).toHaveLength(3);
    expect(slice.isHistoricalSlice).toBe(false);
  });
});

describe('replayTimelineUntil：只读投影', () => {
  it('空事件 ⇒ 空消息与 0 条计数（不臆造）', () => {
    const slice = replayTimelineUntil([], 10);
    expect(slice.messages).toEqual([]);
    expect(slice.eventCount).toBe(0);
    expect(slice.untilSeq).toBe(10);
  });

  it('计数来自切片，不把被裁掉的事件算进去', () => {
    // 用切片函数直接断言计数口径（派生本身由既有 deriveMessagesFromEvents 的测试覆盖，
    // 此处不构造半成品事件去喂派生器 —— 生产事件的 data 形状由 EventLogStorage 保证）
    const slice = sliceEventsUntil(makeEvents(), 2);
    expect(slice.events).toHaveLength(2);
  });

  it('不传 untilSeq 时 untilSeq 字段缺省（对外报 null 由 handler 负责）', () => {
    const slice = replayTimelineUntil([]);
    expect(slice.untilSeq).toBeUndefined();
    expect(slice.isHistoricalSlice).toBe(false);
  });

  it('接线口径：传入 latestSeq（tailSeq）⇒ 即使事件已被裁剪也能识别历史切片', () => {
    // 模拟 `getSessionEvents({ toSeq: 2 })` 的结果：晚于 2 的事件已不在数组里
    const cropped = makeEvents().filter((e) => e.seq <= 2);
    expect(computeIsHistoricalSlice(cropped, 2, 5)).toBe(true);
  });

  it('latestSeq 等于 untilSeq ⇒ 非历史切片（已是最新）', () => {
    const cropped = makeEvents().filter((e) => e.seq <= 2);
    expect(computeIsHistoricalSlice(cropped, 2, 2)).toBe(false);
  });

  it('未传 latestSeq 时按事件本身判断（纯函数自足）', () => {
    expect(computeIsHistoricalSlice(makeEvents(), 2)).toBe(true);
    expect(computeIsHistoricalSlice(makeEvents(), 99)).toBe(false);
  });
});
