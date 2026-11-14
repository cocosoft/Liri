/**
 * timelineSlice.ts — **只读时间旅行**切片（演进方案 W5「Time-Travel 调试」）
 *
 * 定位（`演进方案-极简内核与分层循环.md` §3 W5）：
 * 基于既有 `events.idx` 与 `deriveMessagesFromEvents`，做**只读**的「某时刻会话长什么样」。
 * **不克隆执行、不改任何状态** —— 方案明确"先只读验证价值，再谈克隆执行"。
 *
 * 与既有能力的边界（不重复造）：
 * - 读事件到某 seq：`CoreAPI.getSessionEvents({ toSeq })` 已有；
 * - 事件 → 消息：`deriveMessagesFromEvents` 已有（纯函数）；
 * - 本模块只做**两者之间的切片与事实标记**，不引入第二套派生逻辑。
 *
 * 诚实边界：`untilSeq` 之后的**未落盘内存态**（如进行中的流式增量）不在此视图内 ——
 * 本视图的语义就是"以事件日志为准的历史快照"。
 */

import type { LiriEvent } from '../types/events.js';
import {
  deriveMessagesFromEvents,
  type DerivedMessage,
} from '../storage/EventMessageDeriver.js';

/** 只读时间旅行切片 */
export interface TimelineSlice {
  /** 截止 seq（`undefined` = 全量，等价现状） */
  untilSeq?: number;
  /** 参与派生的事件数（= 切片后的事件条数） */
  eventCount: number;
  /** 传入事件里是否存在**晚于** `untilSeq` 的（true ⇒ 这是一份历史切片，不是最新视图） */
  isHistoricalSlice: boolean;
  /** 由切片事件派生的消息（只读） */
  messages: DerivedMessage[];
}

/**
 * 是否历史切片（纯函数）。
 *
 * - `latestSeq` 提供（接线口径：`tailSeq`）⇒ 直接比较；
 * - 未提供 ⇒ 只看传入事件里是否有晚于 `untilSeq` 的。
 */
export function computeIsHistoricalSlice(
  events: readonly LiriEvent[],
  untilSeq?: number,
  latestSeq?: number
): boolean {
  if (untilSeq === undefined) return false;
  return latestSeq !== undefined
    ? latestSeq > untilSeq
    : events.some((event) => event.seq > untilSeq);
}

/**
 * 按 `untilSeq` 切事件（**纯函数**，不修改入参、不排序、不补齐）。
 *
 * 语义：保留 `seq <= untilSeq` 的事件；`untilSeq` 缺省 ⇒ 全量。
 * 不臆造"补齐到某 seq"的行为 —— 事件缺失就是缺失，切出来是什么就是什么。
 */
export function sliceEventsUntil(
  events: readonly LiriEvent[],
  untilSeq?: number
): { events: LiriEvent[]; isHistoricalSlice: boolean } {
  if (untilSeq === undefined) {
    return { events: [...events], isHistoricalSlice: false };
  }
  const kept = events.filter((event) => event.seq <= untilSeq);
  return {
    events: kept,
    isHistoricalSlice: computeIsHistoricalSlice(events, untilSeq),
  };
}

/**
 * 只读时间旅行：截至 `untilSeq` 的消息投影。
 *
 * 只读保证：不写事件、不动 execution store、不触发任何续跑。
 *
 * @param latestSeq 该会话**最新事件 seq**（可选）。接线时 `getSessionEvents({ toSeq })`
 *   已把晚于 `untilSeq` 的事件裁掉 ⇒ 单看 `events` 无法判断"是否历史切片"，
 *   必须由调用方把 `tailSeq` 传进来；不传则退化为按传入事件判断（纯函数自足）。
 */
export function replayTimelineUntil(
  events: readonly LiriEvent[],
  untilSeq?: number,
  latestSeq?: number
): TimelineSlice {
  const slice = sliceEventsUntil(events, untilSeq);
  const messages = deriveMessagesFromEvents(slice.events, []);
  return {
    ...(untilSeq !== undefined ? { untilSeq } : {}),
    eventCount: slice.events.length,
    isHistoricalSlice: computeIsHistoricalSlice(
      slice.events,
      untilSeq,
      latestSeq
    ),
    messages,
  };
}
